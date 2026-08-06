'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/auth/owner';
import { logAction } from '@/lib/data/action-log';
import { createClient } from '@/lib/supabase/server';
import {
  createTaskSchema,
  formatValidationError,
  idSchema,
  updateTaskSchema,
} from '@/lib/validation/schemas';

/**
 * Task server actions.
 *
 * Each one re-verifies the owner. Server actions are reachable as HTTP
 * endpoints, so the fact that the calling page already checked proves nothing
 * about the caller.
 *
 * Creating, updating and completing a task are Level 1 — internal, reversible
 * and visible. Deletion is Level 2 and goes through the approval flow in
 * Phase 6, so there is deliberately no delete action here.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fields?: Record<string, string> };

export async function createTask(formData: FormData): Promise<ActionResult> {
  const { user } = await requireOwner();

  const parsed = createTaskSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    priority: formData.get('priority') || undefined,
    due_at: formData.get('due_at') || undefined,
    status: formData.get('status') || undefined,
  });

  if (!parsed.success) {
    const { message, fields } = formatValidationError(parsed.error);
    return { ok: false, error: message, fields };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('tasks').insert({
    ...parsed.data,
    user_id: user.id,
  });

  if (error) {
    return { ok: false, error: 'Could not save that task. Please try again.' };
  }

  await logAction({
    toolName: 'tasks.create',
    operationType: 'execute',
    // Summary only — the title is the user's content and stays out of the log.
    actionSummary: 'Created a task',
    status: 'success',
  });

  revalidatePath('/tasks');
  revalidatePath('/today');
  return { ok: true };
}

export async function updateTask(formData: FormData): Promise<ActionResult> {
  await requireOwner();

  const parsed = updateTaskSchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title') || undefined,
    description: formData.get('description') || undefined,
    status: formData.get('status') || undefined,
    priority: formData.get('priority') || undefined,
    due_at: formData.get('due_at') || undefined,
  });

  if (!parsed.success) {
    const { message, fields } = formatValidationError(parsed.error);
    return { ok: false, error: message, fields };
  }

  const { id, ...changes } = parsed.data;
  const supabase = await createClient();

  // RLS scopes this to the caller's own rows; no user_id filter is needed and
  // adding one would imply the policy might not be doing its job.
  const { error } = await supabase.from('tasks').update(changes).eq('id', id);

  if (error) return { ok: false, error: 'Could not update that task.' };

  revalidatePath('/tasks');
  revalidatePath('/today');
  return { ok: true };
}

export async function completeTask(formData: FormData): Promise<ActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That task could not be identified.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('tasks')
    // completed_at must be set alongside the status — a CHECK constraint
    // enforces that the two agree.
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', parsed.data.id);

  if (error) return { ok: false, error: 'Could not complete that task.' };

  await logAction({
    toolName: 'tasks.complete',
    operationType: 'execute',
    actionSummary: 'Completed a task',
    status: 'success',
  });

  revalidatePath('/tasks');
  revalidatePath('/today');
  return { ok: true };
}

export async function reopenTask(formData: FormData): Promise<ActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That task could not be identified.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'inbox', completed_at: null })
    .eq('id', parsed.data.id);

  if (error) return { ok: false, error: 'Could not reopen that task.' };

  revalidatePath('/tasks');
  revalidatePath('/today');
  return { ok: true };
}
