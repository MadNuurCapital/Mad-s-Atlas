'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/auth/owner';
import { approveAndExecuteApproval, executeApproval } from '@/lib/atlas/approvals/service';
import { logAction } from '@/lib/data/action-log';
import { createClient } from '@/lib/supabase/server';
import { idSchema } from '@/lib/validation/schemas';

export type ApprovalActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Record the decision to approve.
 *
 * Approving is NOT executing. This only moves the record to `approved`;
 * execution is a separate, atomic, once-only step. Collapsing the two would
 * mean a double-click could produce two Gmail drafts before the UI caught up.
 */
export async function approve(formData: FormData): Promise<ApprovalActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That approval could not be identified.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('approvals')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    // The RLS policy also enforces this; stating it here makes the intent
    // legible and turns a policy violation into a clean no-op.
    .eq('status', 'pending');

  if (error) return { ok: false, error: 'Could not record that approval.' };

  revalidatePath('/approvals');
  return { ok: true };
}

export async function reject(formData: FormData): Promise<ApprovalActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That approval could not be identified.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('approvals')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('status', 'pending');

  if (error) return { ok: false, error: 'Could not record that rejection.' };

  await logAction({
    toolName: 'approvals.reject',
    operationType: 'execute',
    actionSummary: 'Rejected a proposed action',
    status: 'success',
    approvalId: parsed.data.id,
  });

  revalidatePath('/approvals');
  return { ok: true };
}

/** Run an approved action. Idempotent by construction — see claim_approval(). */
export async function execute(formData: FormData): Promise<ApprovalActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That approval could not be identified.' };

  const outcome = await executeApproval(parsed.data.id);
  revalidatePath('/approvals');
  revalidatePath('/history');

  return outcome.ok ? { ok: true, message: outcome.summary } : { ok: false, error: outcome.message };
}

/** One explicit click for an already reviewed compound Idea operation. */
export async function approveAndExecute(formData: FormData): Promise<ApprovalActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That approval could not be identified.' };

  const outcome = await approveAndExecuteApproval(parsed.data.id, [
    'ideas.execute_plan',
    'ideas.execute_delete',
  ]);
  revalidatePath('/approvals');
  revalidatePath('/history');
  revalidatePath('/ideas');
  revalidatePath('/tasks');
  revalidatePath('/reminders');
  revalidatePath('/today');

  return outcome.ok ? { ok: true, message: outcome.summary } : { ok: false, error: outcome.message };
}
