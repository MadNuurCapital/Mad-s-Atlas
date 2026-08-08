import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { INTRUDER_ID, OWNER_ID, asUser, cleanup, connect, isAvailable, seedUsers } from '../helpers/db';

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
});

afterAll(async () => {
  if (!available) return;
  await cleanup(client);
  await client.end();
});

suite('learning evolution schema', () => {
  it('keeps owner learning rows isolated by RLS', async () => {
    await asUser(client, OWNER_ID, async (q) => {
      await q(`insert into public.learning_items
        (user_id,kind,category,canonical_key,title,summary)
        values ($1,'observation','productivity','uses-tasks','Uses tasks','Observed safe task usage')`, [OWNER_ID]);
      expect((await q('select count(*)::int n from public.learning_items')).rows[0]?.n).toBe(1);
    });
    await asUser(client, INTRUDER_ID, async (q) => {
      expect((await q('select count(*)::int n from public.learning_items')).rows[0]?.n).toBe(0);
    });
  });

  it('rejects invalid confidence and lifecycle values', async () => {
    await expect(client.query(`insert into public.learning_items
      (user_id,kind,category,canonical_key,title,summary,confidence)
      values ($1,'inference','routines','bad-confidence','Bad','Bad',1.5)`, [OWNER_ID])).rejects.toThrow(/learning_items_confidence_check/);
    await expect(client.query(`insert into public.learning_items
      (user_id,kind,category,canonical_key,title,summary,status)
      values ($1,'workflow','workflows','bad-status','Bad','Bad','invented')`, [OWNER_ID])).rejects.toThrow(/learning_items_status_check/);
  });

  it('reset deletes inferred state but preserves confirmed Memory', async () => {
    await client.query(`insert into public.memories
      (user_id,title,content,category,status,confirmed_at)
      values ($1,'Keep me','Confirmed fact','profile','confirmed',now())`, [OWNER_ID]);
    await client.query(`insert into public.learning_items
      (user_id,kind,category,canonical_key,title,summary)
      values ($1,'inference','preferences','reset-me','Reset me','Inference')`, [OWNER_ID]);

    await asUser(client, OWNER_ID, async (q) => {
      await q('select public.reset_learning_engine()');
      expect((await q('select count(*)::int n from public.learning_items')).rows[0]?.n).toBe(0);
      expect((await q('select count(*)::int n from public.memories')).rows[0]?.n).toBe(1);
    });
  });

  it('prevents the client from fabricating system metrics', async () => {
    await asUser(client, OWNER_ID, async (q) => {
      await expect(q(`insert into public.system_metrics
        (user_id,subsystem,metric_name,metric_value,unit,window_started_at,window_ended_at)
        values ($1,'voice','latency_ms',1,'ms',now(),now())`, [OWNER_ID])).rejects.toThrow();
    });
  });
});
