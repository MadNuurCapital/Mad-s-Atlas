import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OWNER_ID, cleanup, connect, isAvailable, seedUsers } from '../helpers/db';

/**
 * The scheduled-job guarantees.
 *
 * A duplicate daily briefing is the failure most likely to go unnoticed, so it
 * has two independent guards and both are tested here.
 */

const available = await isAvailable();
const suite = available ? describe : describe.skip;

let client: Client;

beforeAll(async () => {
  if (!available) return;
  client = await connect();
  await seedUsers(client);
});

beforeEach(async () => {
  if (!available) return;
  await cleanup(client);
  await client.query('delete from private.job_runs');
});

afterAll(async () => {
  if (!available) return;
  await cleanup(client);
  await client.query('delete from private.job_runs');
  await client.end();
});

suite('job claiming', () => {
  it('a second claim of the same unit of work is refused', async () => {
    // This is what makes a duplicate cron firing harmless rather than merely
    // unlikely.
    const runKey = 'daily_briefing:2026-08-06:Asia/Singapore';

    const first = await client.query(
      `insert into private.job_runs (job_name, run_key, status)
       values ('daily_briefing', $1, 'running')
       on conflict (job_name, run_key) do nothing
       returning id`,
      [runKey],
    );
    expect(first.rowCount, 'first claim wins').toBe(1);

    const second = await client.query(
      `insert into private.job_runs (job_name, run_key, status)
       values ('daily_briefing', $1, 'running')
       on conflict (job_name, run_key) do nothing
       returning id`,
      [runKey],
    );
    expect(second.rowCount, 'second claim gets nothing back').toBe(0);
  });

  it('different units of work claim independently', async () => {
    for (const key of ['reminder:a:2026-08-06T01:00:00Z', 'reminder:a:2026-08-07T01:00:00Z']) {
      const result = await client.query(
        `insert into private.job_runs (job_name, run_key, status)
         values ('check_reminders', $1, 'running')
         on conflict (job_name, run_key) do nothing returning id`,
        [key],
      );
      // A recurring reminder must fire on each occurrence — which is why the
      // run key includes the trigger time.
      expect(result.rowCount).toBe(1);
    }
  });

  it('records failures, not only successes', async () => {
    const { rows } = await client.query(
      `insert into private.job_runs (job_name, run_key, status, error_code)
       values ('daily_briefing','k','failed','timeout') returning id`,
    );
    expect(rows).toHaveLength(1);

    const view = await client.query(
      `select status, error_code from private.job_status where job_name = 'daily_briefing'`,
    );
    expect(view.rows[0]?.status).toBe('failed');
  });

  it('rejects an unknown job status', async () => {
    await expect(
      client.query(
        `insert into private.job_runs (job_name, run_key, status)
         values ('x','y','definitely-not-a-status')`,
      ),
    ).rejects.toThrow(/job_runs_status_check/);
  });
});

suite('daily briefing cannot be duplicated', () => {
  it('the unique constraint blocks a second briefing for the same day', async () => {
    // The independent backstop: even if the job lock failed entirely, the
    // database refuses.
    await client.query(
      `insert into public.daily_briefings (user_id, briefing_date, timezone, status)
       values ($1, '2026-08-06', 'Asia/Singapore', 'ready')`,
      [OWNER_ID],
    );

    await expect(
      client.query(
        `insert into public.daily_briefings (user_id, briefing_date, timezone, status)
         values ($1, '2026-08-06', 'Asia/Singapore', 'ready')`,
        [OWNER_ID],
      ),
    ).rejects.toThrow(/daily_briefings_one_per_day/);
  });

  it('an upsert that ignores duplicates leaves exactly one row', async () => {
    // This is the shape the Edge Function actually uses.
    for (let i = 0; i < 3; i += 1) {
      await client.query(
        `insert into public.daily_briefings (user_id, briefing_date, timezone, status)
         values ($1, '2026-08-06', 'Asia/Singapore', 'ready')
         on conflict (user_id, briefing_date, timezone) do nothing`,
        [OWNER_ID],
      );
    }

    const { rows } = await client.query(
      `select count(*)::int as n from public.daily_briefings where user_id = $1`,
      [OWNER_ID],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('allows separate briefings for different days', async () => {
    for (const date of ['2026-08-06', '2026-08-07']) {
      await client.query(
        `insert into public.daily_briefings (user_id, briefing_date, timezone, status)
         values ($1, $2, 'Asia/Singapore', 'ready')`,
        [OWNER_ID, date],
      );
    }

    const { rows } = await client.query(
      `select count(*)::int as n from public.daily_briefings where user_id = $1`,
      [OWNER_ID],
    );
    expect(rows[0]?.n).toBe(2);
  });
});

suite('retention functions', () => {
  it('expires pending approvals past their expiry', async () => {
    await client.query(
      `insert into public.approvals
         (user_id,action_type,title,reason,proposed_payload,payload_hash,status,
          idempotency_key,requested_at,expires_at)
       values ($1,'x','y','z','{}'::jsonb,'h','pending','k-expire',
               now() - interval '3 hours', now() - interval '1 hour')`,
      [OWNER_ID],
    );

    const { rows } = await client.query('select public.purge_expired_approvals() as n');
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);

    const check = await client.query(
      `select status from public.approvals where idempotency_key = 'k-expire'`,
    );
    expect(check.rows[0]?.status).toBe('expired');
  });

  it('expires a suggestion nobody reviewed in 30 days', async () => {
    await client.query(
      `insert into public.memories (user_id,title,content,category,status,created_at)
       values ($1,'Stale','Never reviewed','preference','suggested', now() - interval '40 days')`,
      [OWNER_ID],
    );

    await client.query('select public.expire_memories()');

    const { rows } = await client.query(
      `select status from public.memories where title = 'Stale'`,
    );
    expect(rows[0]?.status).toBe('expired');
  });
});
