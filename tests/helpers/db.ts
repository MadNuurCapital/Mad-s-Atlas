import { Client } from 'pg';

/**
 * Integration-test database helper.
 *
 * Talks to the cluster stood up by `scripts/local-db.sh`, impersonating a
 * Supabase role and user the way PostgREST does: `set local role` plus
 * `set local request.jwt.claim.sub`, both inside a transaction.
 *
 * Both parts matter. `SET LOCAL` outside a transaction is a silent no-op, and
 * without the role change every statement runs as the superuser, which
 * bypasses RLS entirely — a test written that way passes no matter how broken
 * the policies are.
 */

export const TEST_DB_URL =
  process.env.TEST_DB_URL ??
  'postgresql://postgres@/atlas_test?host=/tmp/atlas-pgsock&port=55432';

export const OWNER_ID = '11111111-1111-1111-1111-111111111111';
export const INTRUDER_ID = '22222222-2222-2222-2222-222222222222';

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  return client;
}

/** Is the harness database reachable? Used to skip rather than fail loudly. */
export async function isAvailable(): Promise<boolean> {
  try {
    const client = new Client({ connectionString: TEST_DB_URL });
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };

/**
 * Run `fn` as `authenticated` with `auth.uid()` bound to `userId`.
 * Always rolls back, so tests cannot leak state into one another.
 */
export async function asUser(
  client: Client,
  userId: string,
  fn: (q: (sql: string, params?: unknown[]) => Promise<QueryResult>) => Promise<void>,
): Promise<void> {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    // set_config's third argument = true means transaction-local.
    await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', userId]);

    await fn(async (sql, params) => {
      const result = await client.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    });
  } finally {
    await client.query('rollback');
  }
}

/** Run `fn` as the anonymous role. */
export async function asAnon(
  client: Client,
  fn: (q: (sql: string, params?: unknown[]) => Promise<QueryResult>) => Promise<void>,
): Promise<void> {
  await client.query('begin');
  try {
    await client.query('set local role anon');
    await fn(async (sql, params) => {
      const result = await client.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    });
  } finally {
    await client.query('rollback');
  }
}

/** Seed the two test users. Idempotent. */
export async function seedUsers(client: Client): Promise<void> {
  await client.query(
    `insert into auth.users (id, email) values ($1, $2), ($3, $4)
     on conflict (id) do nothing`,
    [OWNER_ID, 'owner@example.com', INTRUDER_ID, 'intruder@example.com'],
  );
}

/** Remove everything both test users own, in foreign-key-safe order. */
export async function cleanup(client: Client): Promise<void> {
  const ids = [OWNER_ID, INTRUDER_ID];
  await client.query('delete from public.conversation_messages where user_id = any($1)', [ids]);
  await client.query('delete from public.conversations where user_id = any($1)', [ids]);
  await client.query('delete from public.memory_versions where user_id = any($1)', [ids]);
  await client.query('update public.memories set superseded_by = null where user_id = any($1)', [ids]);
  await client.query('delete from public.memories where user_id = any($1)', [ids]);
  await client.query('delete from public.action_logs where user_id = any($1)', [ids]);
  await client.query('delete from public.approvals where user_id = any($1)', [ids]);
  await client.query('delete from public.reminders where user_id = any($1)', [ids]);
  await client.query('delete from public.tasks where user_id = any($1)', [ids]);
  await client.query('delete from public.ideas where user_id = any($1)', [ids]);
  await client.query('delete from public.connected_accounts where user_id = any($1)', [ids]);
  await client.query('delete from public.daily_briefings where user_id = any($1)', [ids]);
}
