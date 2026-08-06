import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Approval, ApprovalStatus } from '@/types/database';

export async function listApprovals(status?: ApprovalStatus): Promise<Approval[]> {
  const supabase = await createClient();

  let query = supabase
    .from('approvals')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(200);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load approvals (${error.code ?? 'unknown'})`);
  return (data ?? []) as Approval[];
}

/** Pending approvals that have not yet expired — what the Today screen counts. */
export async function countPendingApprovals(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('approvals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());

  if (error) return 0;
  return count ?? 0;
}

export type ApprovalBuckets = {
  /** Pending and still within its expiry window. */
  pending: Approval[];
  /** Approved, unexpired, and waiting to be run. */
  readyToRun: Approval[];
  /** Everything else: executed, failed, rejected, or expired. */
  settled: Approval[];
};

/**
 * Split approvals by what can still be done with them.
 *
 * Lives here rather than in the page because it reads the clock, and reading
 * the clock during render is impure — the same reason the History filter
 * cutoff moved into its data function.
 */
export function partitionApprovals(approvals: Approval[]): ApprovalBuckets {
  const now = Date.now();
  const buckets: ApprovalBuckets = { pending: [], readyToRun: [], settled: [] };

  for (const approval of approvals) {
    const live = new Date(approval.expires_at).getTime() > now;

    if (approval.status === 'pending' && live) buckets.pending.push(approval);
    else if (approval.status === 'approved' && live) buckets.readyToRun.push(approval);
    else buckets.settled.push(approval);
  }

  return buckets;
}
