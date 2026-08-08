import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import type { Profile, UserSettings } from '@/types/database';

/**
 * Profile, settings, and the numbers behind the Privacy panel.
 *
 * The privacy summary is generated from the live database rather than written
 * as prose in a document. A retention policy nobody can check is a promise,
 * not a control — this makes it observable.
 */

export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('*').maybeSingle();
  return (data as Profile | null) ?? null;
});

export const getSettings = cache(async (): Promise<UserSettings | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('user_settings').select('*').maybeSingle();
  return (data as UserSettings | null) ?? null;
});

export type ConnectionStatus = {
  provider: string;
  email: string;
  grantedScopes: string[];
  connectionStatus: string;
  lastRefreshedAt: string | null;
};

/**
 * Google connection state.
 *
 * Read from `connected_account_status`, the view with no token columns — so
 * there is nothing sensitive here to leak into a server component's props.
 */
export const getConnectionStatus = cache(async (): Promise<ConnectionStatus | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('connected_account_status').select('*').maybeSingle();

  if (!data) return null;

  const row = data as {
    provider: string;
    email: string;
    granted_scopes: string[] | null;
    connection_status: string;
    last_refreshed_at: string | null;
  };

  return {
    provider: row.provider,
    email: row.email,
    grantedScopes: row.granted_scopes ?? [],
    connectionStatus: row.connection_status,
    lastRefreshedAt: row.last_refreshed_at,
  };
});

export type StoredDataSummary = {
  label: string;
  count: number;
  retention: string;
};

/**
 * What is stored, counted live.
 *
 * Deliberately includes the zero rows: "0 stored audio recordings" is more
 * reassuring than the absence of a line, because it shows the category was
 * considered rather than forgotten.
 */
/**
 * Countable tables, named as a literal tuple.
 *
 * The generated database types reject a loose `string` here, which is the
 * point: a table renamed in a migration becomes a compile error rather than a
 * silently-zero row in the privacy panel.
 */
const COUNTED_TABLES = [
  'memories',
  'tasks',
  'reminders',
  'ideas',
  'approvals',
  'action_logs',
  'conversations',
  'research_reports',
] as const;

type CountedTable = (typeof COUNTED_TABLES)[number];

const TABLE_LABEL: Record<CountedTable, string> = {
  memories: 'Memories',
  tasks: 'Tasks',
  reminders: 'Reminders',
  ideas: 'Ideas',
  approvals: 'Approvals',
  action_logs: 'Action log entries',
  conversations: 'Conversations',
  research_reports: 'Research reports',
};

/** Mirrors DATA_RETENTION.md. If one changes, change both in the same commit. */
const TABLE_RETENTION: Record<CountedTable, string> = {
  memories: 'Kept until you delete them',
  tasks: 'Kept until you delete them',
  reminders: 'Kept while active',
  ideas: 'Kept until you archive them',
  approvals: '180 days after completion',
  action_logs: '365 days',
  conversations: 'Your retention setting',
  research_reports: 'Kept until you delete them',
};

export async function getStoredDataSummary(): Promise<StoredDataSummary[]> {
  const supabase = await createClient();

  async function count(table: CountedTable): Promise<number> {
    const { count: n } = await supabase.from(table).select('id', { count: 'exact', head: true });
    return n ?? 0;
  }

  // Built by mapping the tuple rather than destructuring the results array:
  // under noUncheckedIndexedAccess every destructured element would be
  // `number | undefined`, and silencing that would defeat the check.
  const counts = await Promise.all(COUNTED_TABLES.map(count));

  const rows: StoredDataSummary[] = COUNTED_TABLES.map((table, index) => ({
    label: TABLE_LABEL[table],
    count: counts[index] ?? 0,
    retention: TABLE_RETENTION[table],
  }));

  return [
    ...rows,
    // The two lines that matter most are the ones that always read zero.
    { label: 'Stored audio recordings', count: 0, retention: 'Never stored, ever' },
    { label: 'Stored email bodies', count: 0, retention: 'Never stored, ever' },
  ];
}
