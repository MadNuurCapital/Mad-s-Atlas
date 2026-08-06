import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { INTRUDER_ID, OWNER_ID, asUser, cleanup, connect, isAvailable, seedUsers } from '../helpers/db';

/**
 * The approval gate.
 *
 * These tests exist because "an approval executes at most once" is a claim
 * that is only worth anything if it is enforced by the database rather than by
 * a disabled button. Each case here is a way the guarantee could be broken.
 */

const available = await isAvailable();
const suite = available ? describe : describe.skip;

let client: Client;

type SeedOptions = {
  id: string;
  key: string;
  status?: string;
  requestedAt?: string;
  expiresAt?: string;
  approvedAt?: string | null;
  userId?: string;
};

async function seedApproval(o: SeedOptions): Promise<void> {
  await client.query(
    `insert into public.approvals
       (id, user_id, action_type, title, reason, proposed_payload, payload_hash,
        status, idempotency_key, requested_at, expires_at, approved_at)
     values ($1,$2,'gmail.execute_create_draft','Draft','Test',
             '{"to":"x@y.z"}'::jsonb,'hash-abc',$3,$4,
             ${o.requestedAt ?? 'now()'}, ${o.expiresAt ?? "now() + interval '30 minutes'"},
             ${o.approvedAt === null ? 'null' : (o.approvedAt ?? 'now()')})`,
    [o.id, o.userId ?? OWNER_ID, o.status ?? 'approved', o.key],
  );
}

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

suite('claim_approval', () => {
  it('claims an approved, unexpired approval exactly once', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-00000000a001';
    await seedApproval({ id, key: 'k-a001' });

    await asUser(client, OWNER_ID, async (q) => {
      const { rows } = await q('select * from public.claim_approval($1,$2)', [id, 'k-a001']);
      expect(rows[0]?.status).toBe('executed');
      expect(rows[0]?.executed_at).not.toBeNull();
    });
  });

  it('REFUSES a second claim of the same approval', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-00000000a002';
    await seedApproval({ id, key: 'k-a002' });

    // First claim commits, so the second sees the real post-claim state.
    await client.query('set role authenticated');
    await client.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', OWNER_ID]);
    const first = await client.query('select status from public.claim_approval($1,$2)', [id, 'k-a002']);
    expect(first.rows[0]?.status).toBe('executed');

    await expect(
      client.query('select status from public.claim_approval($1,$2)', [id, 'k-a002']),
    ).rejects.toThrow(/approval_not_claimable/);

    await client.query('reset role');
    await client.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', '']);
  });

  it('refuses an EXPIRED approval even though it was approved', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-00000000a003';
    await seedApproval({
      id,
      key: 'k-a003',
      requestedAt: "now() - interval '3 hours'",
      expiresAt: "now() - interval '1 hour'",
      approvedAt: "now() - interval '2 hours'",
    });

    await expect(
      asUser(client, OWNER_ID, async (q) => {
        await q('select public.claim_approval($1,$2)', [id, 'k-a003']);
      }),
    ).rejects.toThrow(/approval_not_claimable/);
  });

  it('refuses an approval that was never approved', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-00000000a004';
    await seedApproval({ id, key: 'k-a004', status: 'pending', approvedAt: null });

    await expect(
      asUser(client, OWNER_ID, async (q) => {
        await q('select public.claim_approval($1,$2)', [id, 'k-a004']);
      }),
    ).rejects.toThrow(/approval_not_claimable/);
  });

  it('refuses a mismatched idempotency key', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-00000000a005';
    await seedApproval({ id, key: 'k-a005' });

    await expect(
      asUser(client, OWNER_ID, async (q) => {
        await q('select public.claim_approval($1,$2)', [id, 'wrong-key']);
      }),
    ).rejects.toThrow(/approval_not_claimable/);
  });

  it('refuses a claim from a different user', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-00000000a006';
    await seedApproval({ id, key: 'k-a006' });

    await expect(
      asUser(client, INTRUDER_ID, async (q) => {
        await q('select public.claim_approval($1,$2)', [id, 'k-a006']);
      }),
    ).rejects.toThrow(/approval_not_claimable/);
  });

  it('survives two concurrent claims — exactly one wins', async () => {
    // The realistic double-click: two connections racing on the same row.
    const id = 'aaaaaaaa-0000-0000-0000-00000000a007';
    await seedApproval({ id, key: 'k-a007' });

    const a = await connect();
    const b = await connect();
    try {
      for (const c of [a, b]) {
        await c.query('set role authenticated');
        await c.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', OWNER_ID]);
      }

      const results = await Promise.allSettled([
        a.query('select status from public.claim_approval($1,$2)', [id, 'k-a007']),
        b.query('select status from public.claim_approval($1,$2)', [id, 'k-a007']),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length, 'exactly one claim must succeed').toBe(1);
      expect(rejected.length, 'the other must be refused').toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  });
});

suite('approval integrity constraints', () => {
  it('rejects a duplicate idempotency key', async () => {
    await seedApproval({ id: 'aaaaaaaa-0000-0000-0000-00000000a008', key: 'k-dup' });
    await expect(
      seedApproval({ id: 'aaaaaaaa-0000-0000-0000-00000000a009', key: 'k-dup' }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rejects an expiry that precedes the request', async () => {
    await expect(
      seedApproval({
        id: 'aaaaaaaa-0000-0000-0000-00000000a010',
        key: 'k-a010',
        expiresAt: "now() - interval '1 hour'",
      }),
    ).rejects.toThrow(/approvals_expiry_after_request/);
  });

  it('a client cannot promote its own approval to executed', async () => {
    // Approving is not executing. Only claim_approval() may set 'executed',
    // and it does so atomically.
    const id = 'aaaaaaaa-0000-0000-0000-00000000a011';
    await seedApproval({ id, key: 'k-a011', status: 'pending', approvedAt: null });

    await expect(
      asUser(client, OWNER_ID, async (q) => {
        await q(`update public.approvals set status = 'executed' where id = $1`, [id]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a client cannot insert an approval at all', async () => {
    // Approvals are created by the orchestrator server-side, so a client
    // cannot fabricate one for an action Atlas never proposed.
    await expect(
      asUser(client, OWNER_ID, async (q) => {
        await q(
          `insert into public.approvals
             (user_id,action_type,title,reason,proposed_payload,payload_hash,
              status,idempotency_key,expires_at)
           values ($1,'x','y','z','{}'::jsonb,'h','approved','k-forged',
                   now() + interval '1 hour')`,
          [OWNER_ID],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});
