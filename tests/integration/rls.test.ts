import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { INTRUDER_ID, OWNER_ID, asAnon, asUser, cleanup, connect, isAvailable, seedUsers } from '../helpers/db';

/**
 * Row Level Security — the suite the whole product rests on.
 *
 * Requires the local harness:
 *     bash scripts/local-db.sh start
 *
 * Skipped (not failed) when unavailable, so `npm run verify` stays useful
 * without a database. CI must run it with the harness up.
 */

const available = await isAvailable();
const suite = available ? describe : describe.skip;

if (!available) {
  console.warn(
    '\n  ⚠ RLS tests SKIPPED — no database at TEST_DB_URL.\n' +
      '    Start it with: bash scripts/local-db.sh start\n',
  );
}

let client: Client;

beforeAll(async () => {
  if (!available) return;
  client = await connect();
  await seedUsers(client);
  await cleanup(client);
});

afterAll(async () => {
  if (!available) return;
  await cleanup(client);
  await client.end();
});

suite('RLS coverage', () => {
  it('every table in public has RLS enabled and at least one policy', async () => {
    // This is the test that catches a NEW table shipped without policies —
    // the most likely way a gap gets introduced later.
    const { rows } = await client.query(`
      select c.relname, c.relrowsecurity, count(p.polname)::int as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      group by c.relname, c.relrowsecurity
      having c.relrowsecurity = false or count(p.polname) = 0
    `);

    expect(rows, `unprotected tables: ${rows.map((r) => r.relname).join(', ')}`).toEqual([]);
  });

  it('no policy grants anon or uses a bare TRUE predicate', async () => {
    const { rows } = await client.query(`
      select c.relname, p.polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where pg_get_expr(p.polqual, p.polrelid) = 'true'
         or 'anon' = any(select rolname from pg_roles where oid = any(p.polroles))
    `);
    expect(rows).toEqual([]);
  });

  it('every security-definer function pins search_path', async () => {
    // Without a pinned search_path a definer function can be hijacked by a
    // shadowing object in a schema the caller controls.
    const { rows } = await client.query(`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
        and n.nspname in ('public', 'private')
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
          where cfg like 'search_path=%'
        )
    `);
    expect(rows, `unpinned: ${rows.map((r) => r.fn).join(', ')}`).toEqual([]);
  });
});

suite('cross-user isolation', () => {
  const tables = [
    'memories',
    'tasks',
    'reminders',
    'ideas',
    'idea_steps',
    'idea_notes',
    'conversations',
  ] as const;

  it.each(tables)('an intruder cannot read, update or delete the owner\'s %s', async (table) => {
    // Seed one owner row using the server-side (secret-key) path.
    const seed: Record<string, string> = {
      memories:
        `insert into public.memories (user_id,title,content,category) values ($1,'t','c','profile')`,
      tasks: `insert into public.tasks (user_id,title) values ($1,'t')`,
      reminders: `insert into public.reminders (user_id,title,remind_at) values ($1,'t',now())`,
      ideas: `insert into public.ideas (user_id,title,original_capture) values ($1,'t','c')`,
      idea_steps: `with parent as (insert into public.ideas (user_id,title,original_capture) values ($1,'parent','c') returning id) insert into public.idea_steps (user_id,idea_id,position,title) select $1,id,0,'s' from parent`,
      idea_notes: `with parent as (insert into public.ideas (user_id,title,original_capture) values ($1,'parent','c') returning id) insert into public.idea_notes (user_id,idea_id,content) select $1,id,'n' from parent`,
      conversations: `insert into public.conversations (user_id,channel) values ($1,'text')`,
    };
    await client.query(seed[table] as string, [OWNER_ID]);

    await asUser(client, OWNER_ID, async (q) => {
      const own = await q(`select count(*)::int as n from public.${table}`);
      expect(own.rows[0]?.n, 'owner should see their own row').toBeGreaterThan(0);
    });

    await asUser(client, INTRUDER_ID, async (q) => {
      const read = await q(`select count(*)::int as n from public.${table}`);
      expect(read.rows[0]?.n, 'intruder must see nothing').toBe(0);

      const updated = await q(`update public.${table} set updated_at = now()`);
      expect(updated.rowCount, 'intruder must update nothing').toBe(0);

      const deleted = await q(`delete from public.${table}`);
      expect(deleted.rowCount, 'intruder must delete nothing').toBe(0);
    });

    // And the owner's data survived all of it.
    await asUser(client, OWNER_ID, async (q) => {
      const after = await q(`select count(*)::int as n from public.${table}`);
      expect(after.rows[0]?.n).toBeGreaterThan(0);
    });

    await client.query(`delete from public.${table} where user_id = $1`, [OWNER_ID]);
  });

  it('a user cannot insert a row owned by someone else', async () => {
    await expect(
      asUser(client, INTRUDER_ID, async (q) => {
        await q(
          `insert into public.memories (user_id,title,content,category)
           values ($1,'forged','x','profile')`,
          [OWNER_ID],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a user cannot attach their step or note to another owner\'s Idea UUID', async () => {
    const { rows } = await client.query(
      `insert into public.ideas (user_id,title,original_capture)
       values ($1,'owner idea','private') returning id`,
      [OWNER_ID],
    );
    const ideaId = rows[0]?.id;

    await expect(
      asUser(client, INTRUDER_ID, async (q) => {
        await q(
          `insert into public.idea_notes (user_id,idea_id,content)
           values ($1,$2,'cross-owner')`,
          [INTRUDER_ID, ideaId],
        );
      }),
    ).rejects.toThrow(/foreign key|violates/i);

    await expect(
      asUser(client, INTRUDER_ID, async (q) => {
        await q(
          `insert into public.idea_steps (user_id,idea_id,position,title)
           values ($1,$2,0,'cross-owner')`,
          [INTRUDER_ID, ideaId],
        );
      }),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('the original Idea wording is immutable after capture', async () => {
    const { rows } = await client.query(
      `insert into public.ideas (user_id,title,original_capture)
       values ($1,'immutable idea','exact words') returning id`,
      [OWNER_ID],
    );

    await expect(
      asUser(client, OWNER_ID, async (q) => {
        await q(`update public.ideas set original_capture = 'rewritten' where id = $1`, [rows[0]?.id]);
      }),
    ).rejects.toThrow(/idea_original_capture_is_immutable/i);
  });

  it('the anonymous role can read nothing', async () => {
    await expect(
      asAnon(client, async (q) => {
        await q('select count(*) from public.memories');
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

suite('connected_accounts token protection', () => {
  it('a client cannot select the encrypted token columns', async () => {
    await client.query(
      `insert into public.connected_accounts
         (user_id,provider,provider_account_id,email,
          encrypted_access_token,encrypted_refresh_token,
          token_initialisation_vector,token_authentication_tag)
       values ($1,'google','sub-1','owner@example.com',
               '\\x01'::bytea,'\\x02'::bytea,'\\x03'::bytea,'\\x04'::bytea)
       on conflict do nothing`,
      [OWNER_ID],
    );

    await expect(
      asUser(client, OWNER_ID, async (q) => {
        await q('select encrypted_refresh_token from public.connected_accounts');
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('the safe status view IS readable and exposes no token columns', async () => {
    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q('select * from public.connected_account_status');
      expect(rows.length).toBe(1);

      // Name the secret-bearing columns explicitly. Matching /token/i would
      // also flag access_token_expires_at, which carries an expiry timestamp
      // and no secret — the client needs it to show connection status.
      const forbidden = [
        'encrypted_access_token',
        'encrypted_refresh_token',
        'token_initialisation_vector',
        'token_authentication_tag',
      ];
      const present = Object.keys(rows[0] ?? {});
      for (const column of forbidden) {
        expect(present).not.toContain(column);
      }
    });
  });

  it('REFUSES to overwrite a valid refresh token with NULL', async () => {
    // The failure this prevents is silent and delayed: Google omits the
    // refresh token on most re-consents, so naive code nulls it and nothing
    // looks broken until the next unattended cron run days later.
    await expect(
      client.query(
        `update public.connected_accounts set encrypted_refresh_token = null
         where user_id = $1`,
        [OWNER_ID],
      ),
    ).rejects.toThrow(/refusing to erase a valid google refresh token/i);
  });

  it('allows rotating the access token while preserving the refresh token', async () => {
    await client.query(
      `update public.connected_accounts set encrypted_access_token = '\\x09'::bytea
       where user_id = $1`,
      [OWNER_ID],
    );
    const { rows } = await client.query(
      `select encrypted_refresh_token is not null as kept
       from public.connected_accounts where user_id = $1`,
      [OWNER_ID],
    );
    expect(rows[0]?.kept).toBe(true);
  });
});

suite('email normalisation', () => {
  it('collapses Gmail dots and +aliases so the allowlist cannot be bypassed', async () => {
    const { rows } = await client.query(`
      select
        private.normalise_email('M.Ad+newsletter@GMail.com')::text as variant,
        private.normalise_email('mad@gmail.com')::text as plain,
        private.normalise_email('a.b@outlook.com')::text as other_domain,
        private.normalise_email('not-an-email') as invalid
    `);
    const row = rows[0] ?? {};
    expect(row.variant).toBe('mad@gmail.com');
    expect(row.plain).toBe('mad@gmail.com');
    // Dots are only insignificant on Google-hosted domains.
    expect(row.other_domain).toBe('a.b@outlook.com');
    expect(row.invalid).toBeNull();
  });
});
