import 'server-only';

import { requireOwnerApi } from '@/lib/auth/owner';
import { redactForLog } from '@/lib/validation/redact';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionLog, ActionStatus, OperationType } from '@/types/database';
import { createClient } from '@/lib/supabase/server';

/**
 * The audit trail.
 *
 * What Atlas did — never the sensitive content it touched. Summaries are
 * redacted before they are written, and `metadata` carries counts and
 * identifiers only.
 *
 * Writes use the admin client because `action_logs` is append-only from the
 * client's perspective: there is no INSERT grant for `authenticated`, so a
 * compromised browser session cannot forge or suppress audit entries.
 */

export type LogActionInput = {
  toolName: string;
  operationType: OperationType;
  actionSummary: string;
  status: ActionStatus;
  approvalId?: string | null;
  durationMs?: number | null;
  errorCode?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

/**
 * Record an action.
 *
 * Never throws. A failure to write the audit trail must not take down the
 * operation being audited — but it is reported, because a silently missing
 * audit trail is its own problem.
 */
export async function logAction(input: LogActionInput): Promise<void> {
  try {
    const session = await requireOwnerApi();
    if (!session.ok) return;

    const admin = createAdminClient();
    const { error } = await admin.from('action_logs').insert({
      user_id: session.session.user.id,
      session_id: input.sessionId ?? null,
      tool_name: input.toolName,
      operation_type: input.operationType,
      action_summary: redactForLog(input.actionSummary),
      status: input.status,
      approval_id: input.approvalId ?? null,
      duration_ms: input.durationMs ?? null,
      error_code: input.errorCode ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error('[action-log] write failed', { code: error.code });
    }
  } catch (error) {
    console.error('[action-log] threw', {
      name: error instanceof Error ? error.name : 'unknown',
    });
  }
}

export type ActionLogFilters = {
  toolName?: string;
  status?: ActionStatus;
  operationType?: OperationType;
  /**
   * How many days back to look. Resolved to a timestamp HERE rather than by
   * the caller: reading the clock inside a component body is impure, and the
   * value belongs with the query it constrains.
   */
  sinceDays?: number;
  limit?: number;
};

export async function listActionLogs(filters: ActionLogFilters = {}): Promise<ActionLog[]> {
  const supabase = await createClient();

  let query = supabase
    .from('action_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(filters.limit ?? 100, 500));

  if (filters.toolName) query = query.eq('tool_name', filters.toolName);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.operationType) query = query.eq('operation_type', filters.operationType);
  if (filters.sinceDays && Number.isFinite(filters.sinceDays)) {
    const cutoff = new Date(Date.now() - filters.sinceDays * 86_400_000);
    query = query.gte('created_at', cutoff.toISOString());
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load action history (${error.code ?? 'unknown'})`);

  return (data ?? []) as ActionLog[];
}

/** Distinct tool names present in the log, for the filter control. */
export async function listLoggedToolNames(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('action_logs')
    .select('tool_name')
    .order('tool_name')
    .limit(1000);

  if (error) return [];
  return [...new Set((data ?? []).map((row) => row.tool_name as string))];
}
