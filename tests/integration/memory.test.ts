import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OWNER_ID, asUser, cleanup, connect, isAvailable, seedUsers } from '../helpers/db';

/**
 * The memory system's load-bearing properties.
 *
 * Two of these are product requirements rather than mere correctness:
 * a save must never depend on an embedding, and a suggestion must never become
 * confirmed on its own.
 */

const available = await isAvailable();
const suite = available ? describe : describe.skip;

let client: Client;

/** A deterministic unit vector, so similarity results are reproducible. */
function fakeEmbedding(seed: number): string {
  const values = Array.from({ length: 1536 }, (_, i) => Math.sin((i + 1) * seed) / 40);
  return `[${values.join(',')}]`;
}

beforeAll(async () => {
  if (!available) return;
  client = await connect();
  await seedUsers(client);
});

beforeEach(async () => {
  if (!available) return;
  await cleanup(client);
});

afterAll(async () => {
  if (!available) return;
  await cleanup(client);
  await client.end();
});

suite('saving a memory', () => {
  it('SUCCEEDS with a null embedding', async () => {
    // The most important property here. Embeddings are generated
    // asynchronously; a provider outage must never lose what Muhammad said.
    await asUser(client, OWNER_ID, async (q) => {
      const result = await q(
        `insert into public.memories
           (user_id, title, content, category, status, confirmed_at)
         values ($1,'Based in Singapore','Muhammad lives in Singapore.','profile',
                 'confirmed', now())
         returning id, embedding`,
        [OWNER_ID],
      );

      expect(result.rowCount).toBe(1);
      expect(result.rows[0]?.embedding, 'embedding starts null').toBeNull();
    });
  });

  it('is immediately findable by full-text search without any embedding', async () => {
    await client.query(
      `insert into public.memories (user_id,title,content,category,status,confirmed_at)
       values ($1,'Coffee preference','Muhammad prefers flat whites in the morning.',
               'preference','confirmed',now())`,
      [OWNER_ID],
    );

    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select title from public.memories
         where search_vector @@ websearch_to_tsquery('english', $1)`,
        ['flat whites'],
      );
      expect(rows.length).toBe(1);
    });
  });

  it('refuses temporary context without an expiry', async () => {
    // Temporary context that never expires is not temporary — it is permanent
    // memory that nobody chose to keep.
    await expect(
      client.query(
        `insert into public.memories (user_id,title,content,category)
         values ($1,'Travelling','Away until the 20th','temporary_context')`,
        [OWNER_ID],
      ),
    ).rejects.toThrow(/memories_temporary_needs_expiry/);
  });

  it('refuses a confirmed memory with no confirmation timestamp', async () => {
    await expect(
      client.query(
        `insert into public.memories (user_id,title,content,category,status)
         values ($1,'x','y','profile','confirmed')`,
        [OWNER_ID],
      ),
    ).rejects.toThrow(/memories_confirmed_has_timestamp/);
  });

  it('refuses a confidence outside 0..1', async () => {
    await expect(
      client.query(
        `insert into public.memories (user_id,title,content,category,confidence)
         values ($1,'x','y','profile',1.5)`,
        [OWNER_ID],
      ),
    ).rejects.toThrow(/memories_confidence_check/);
  });
});

suite('suggestions never become fact on their own', () => {
  beforeEach(async () => {
    await client.query(
      `insert into public.memories (user_id,title,content,category,status)
       values ($1,'Maybe true','Extracted from a conversation','preference','suggested')`,
      [OWNER_ID],
    );
  });

  it('excludes suggestions from hybrid retrieval', async () => {
    // Retrieval is what informs answers. A suggestion appearing here would be
    // Atlas treating an unverified guess as fact.
    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select id from public.search_memories_hybrid($1, null, null, 12, false)`,
        ['Maybe true'],
      );
      expect(rows).toEqual([]);
    });
  });

  it('excludes suggestions from semantic search', async () => {
    await client.query(
      `update public.memories set embedding = $1::extensions.vector where user_id = $2`,
      [fakeEmbedding(1), OWNER_ID],
    );

    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select id from public.search_memories_semantic($1::extensions.vector, 12, 0)`,
        [fakeEmbedding(1)],
      );
      expect(rows).toEqual([]);
    });
  });

  it('includes it once confirmed', async () => {
    await client.query(
      `update public.memories
          set status='confirmed', confirmed_at=now(), last_confirmed_at=now()
        where user_id=$1 and status='suggested'`,
      [OWNER_ID],
    );

    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select id from public.search_memories_hybrid($1, null, null, 12, false)`,
        ['Maybe true'],
      );
      expect(rows.length).toBe(1);
    });
  });
});

suite('hybrid retrieval', () => {
  beforeEach(async () => {
    await client.query(
      `insert into public.memories (user_id,title,content,category,status,confirmed_at,confidence)
       values
         ($1,'Singapore base','Muhammad is based in Singapore.','profile','confirmed',now(),1.0),
         ($1,'Morning routine','Reviews the week on Sunday evening.','routine','confirmed',now(),0.8),
         ($1,'Health note','A sensitive health detail.','profile','confirmed',now(),0.9)`,
      [OWNER_ID],
    );
    await client.query(
      `update public.memories set sensitivity='highly_sensitive' where title='Health note'`,
    );
  });

  it('withholds highly sensitive memories by default', async () => {
    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select title from public.search_memories_hybrid($1, null, null, 12, false)`,
        ['Muhammad'],
      );
      expect(rows.map((r) => r.title)).not.toContain('Health note');
    });
  });

  it('includes them only when the request directly concerns them', async () => {
    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select title from public.search_memories_hybrid($1, null, null, 12, true)`,
        ['health'],
      );
      expect(rows.map((r) => r.title)).toContain('Health note');
    });
  });

  it('filters by category when the intent implies one', async () => {
    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select category from public.search_memories_hybrid($1, null, $2, 12, false)`,
        ['', ['routine']],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.category).toBe('routine');
    });
  });

  it('caps the number of results however many are requested', async () => {
    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select id from public.search_memories_hybrid($1, null, null, 9999, true)`,
        ['Muhammad'],
      );
      expect(rows.length).toBeLessThanOrEqual(50);
    });
  });

  it('works without an embedding — degrades to text rather than failing', async () => {
    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select title, vector_similarity from public.search_memories_hybrid($1, null, null, 12, false)`,
        ['Singapore'],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(Number(rows[0]?.vector_similarity)).toBe(0);
    });
  });

  it('excludes expired and soft-deleted memories', async () => {
    await client.query(
      `insert into public.memories
         (user_id,title,content,category,status,confirmed_at,expires_at)
       values ($1,'Old context','No longer true','temporary_context','confirmed',now(),
               now() - interval '1 day')`,
      [OWNER_ID],
    );
    await client.query(
      `insert into public.memories
         (user_id,title,content,category,status,confirmed_at,deleted_at)
       values ($1,'Removed','Deleted memory','profile','confirmed',now(),now())`,
      [OWNER_ID],
    );

    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q(
        `select title from public.search_memories_hybrid($1, null, null, 50, true)`,
        ['context OR Deleted OR Removed'],
      );
      const titles = rows.map((r) => r.title);
      expect(titles).not.toContain('Old context');
      expect(titles).not.toContain('Removed');
    });
  });
});

suite('version history', () => {
  it('records the prior content on edit, by trigger', async () => {
    const { rows } = await client.query(
      `insert into public.memories (user_id,title,content,category,status,confirmed_at)
       values ($1,'Original','The original content.','profile','confirmed',now())
       returning id`,
      [OWNER_ID],
    );
    const id = rows[0]?.id as string;

    // The update and the assertion must share a transaction: asUser() always
    // rolls back, so a version row written by the trigger would vanish before
    // a separate query could see it.
    await asUser(client, OWNER_ID, async (q) => {
      await q(`update public.memories set content='Revised content.' where id=$1`, [id]);

      const versions = await q(
        `select previous_content, change_reason from public.memory_versions where memory_id=$1`,
        [id],
      );
      expect(versions.rowCount).toBe(1);
      expect(versions.rows[0]?.previous_content).toBe('The original content.');
      expect(versions.rows[0]?.change_reason).toBe('edited');
    });
  });

  it('does NOT record a version for a status-only change', async () => {
    // Otherwise confirming a memory or backfilling an embedding would flood
    // the history with entries that record no actual change.
    const { rows } = await client.query(
      `insert into public.memories (user_id,title,content,category,status)
       values ($1,'Pending','Some content.','profile','suggested')
       returning id`,
      [OWNER_ID],
    );
    const id = rows[0]?.id as string;

    await client.query(
      `update public.memories set status='confirmed', confirmed_at=now() where id=$1`,
      [id],
    );

    const versions = await client.query(
      `select count(*)::int as n from public.memory_versions where memory_id=$1`,
      [id],
    );
    expect(versions.rows[0]?.n).toBe(0);
  });

  it('a client cannot write a version row directly', async () => {
    await expect(
      asUser(client, OWNER_ID, async (q) => {
        await q(
          `insert into public.memory_versions (memory_id,user_id,previous_content)
           values (gen_random_uuid(),$1,'forged')`,
          [OWNER_ID],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

suite('export and deletion', () => {
  it('export excludes embeddings and token columns by construction', async () => {
    await client.query(
      `insert into public.memories (user_id,title,content,category,status,confirmed_at,embedding)
       values ($1,'Exported','Content','profile','confirmed',now(),$2::extensions.vector)`,
      [OWNER_ID, fakeEmbedding(2)],
    );
    await client.query(
      `insert into public.connected_accounts
         (user_id,provider,provider_account_id,email,encrypted_refresh_token)
       values ($1,'google','sub-export','owner@example.com','\\x02'::bytea)
       on conflict do nothing`,
      [OWNER_ID],
    );

    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q('select public.export_all_user_data() as data');
      const raw = JSON.stringify(rows[0]?.data);

      expect(raw).toContain('Exported');

      // Match the KEY, not the substring: `embedding_attempts` is a harmless
      // retry counter and legitimately contains the word "embedding".
      expect(raw).not.toContain('"embedding":');
      expect(raw).not.toContain('"search_vector":');
      expect(raw).not.toContain('encrypted_refresh_token');
      expect(raw).not.toContain('encrypted_access_token');
      expect(raw).not.toContain('token_authentication_tag');
    });
  });

  it('complete deletion removes everything in foreign-key-safe order', async () => {
    const { rows } = await client.query(
      `insert into public.memories (user_id,title,content,category,status,confirmed_at)
       values ($1,'A','a','profile','confirmed',now()),
              ($1,'B','b','profile','confirmed',now())
       returning id`,
      [OWNER_ID],
    );
    // A self-reference is the case that breaks a naive delete order.
    await client.query(`update public.memories set superseded_by=$1 where id=$2`, [
      rows[1]?.id,
      rows[0]?.id,
    ]);

    await asUser(client, OWNER_ID, async (q) => {
      await q('select public.delete_all_user_data()');
      const remaining = await q('select count(*)::int as n from public.memories');
      expect(remaining.rows[0]?.n).toBe(0);
    });
  });
});
