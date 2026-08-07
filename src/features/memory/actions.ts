'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireOwner } from '@/lib/auth/owner';
import { logAction } from '@/lib/data/action-log';
import { createClient } from '@/lib/supabase/server';
import { formatValidationError, idSchema } from '@/lib/validation/schemas';

/**
 * Memory server actions.
 *
 * Suggestions still require explicit confirmation. Direct memories created by
 * Muhammad, including stable facts and agreed plans he asks Atlas to retain in
 * a voice conversation, are confirmed at creation and remain visible and
 * deletable on the Memory page.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fields?: Record<string, string> };

const MEMORY_CATEGORIES = [
  'profile',
  'preference',
  'goal',
  'routine',
  'important_person',
  'project',
  'commitment',
  'decision',
  'idea_reference',
  'temporary_context',
] as const;

const SENSITIVITIES = ['normal', 'personal', 'sensitive', 'highly_sensitive'] as const;

const saveMemorySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
  category: z.enum(MEMORY_CATEGORIES),
  sensitivity: z.enum(SENSITIVITIES).default('normal'),
  expires_at: z
    .string()
    .trim()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be a valid date')
    .nullable()
    .optional(),
});

/**
 * Create a memory the user typed themselves.
 *
 * Directly confirmed, because Muhammad wrote it and pressed save — that IS the
 * confirmation. Memories *extracted* from conversation take the suggestion
 * path instead and wait for review.
 */
export async function saveMemory(formData: FormData): Promise<ActionResult> {
  const { user } = await requireOwner();

  const parsed = saveMemorySchema.safeParse({
    title: formData.get('title'),
    content: formData.get('content'),
    category: formData.get('category'),
    sensitivity: formData.get('sensitivity') || undefined,
    expires_at: formData.get('expires_at') || undefined,
  });

  if (!parsed.success) {
    const { message, fields } = formatValidationError(parsed.error);
    return { ok: false, error: message, fields };
  }

  // A temporary_context memory without an expiry is not temporary; the
  // database rejects it, so catch it here with a message that explains why.
  if (parsed.data.category === 'temporary_context' && !parsed.data.expires_at) {
    return {
      ok: false,
      error: 'Temporary context needs an expiry date, otherwise it is not temporary.',
      fields: { expires_at: 'Required for temporary context' },
    };
  }

  const now = new Date().toISOString();
  const supabase = await createClient();

  const { error } = await supabase.from('memories').insert({
    user_id: user.id,
    title: parsed.data.title,
    content: parsed.data.content,
    category: parsed.data.category,
    sensitivity: parsed.data.sensitivity,
    expires_at: parsed.data.expires_at ?? null,
    status: 'confirmed',
    confirmed_at: now,
    last_confirmed_at: now,
    confidence: 1,
    source_type: 'manual',
    // embedding stays null. The backfill job fills it in, and the memory is
    // fully searchable by full text in the meantime. A provider outage must
    // never lose what Muhammad said.
  });

  if (error) {
    return { ok: false, error: 'Could not save that memory. Please try again.' };
  }

  await logAction({
    toolName: 'memory.confirm_save',
    operationType: 'execute',
    actionSummary: `Saved a ${parsed.data.category} memory`,
    status: 'success',
    metadata: { category: parsed.data.category, sensitivity: parsed.data.sensitivity },
  });

  revalidatePath('/memory');
  return { ok: true };
}

/** Promote a suggestion to confirmed. Only ever called from an explicit click. */
export async function confirmMemory(formData: FormData): Promise<ActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That memory could not be identified.' };

  const now = new Date().toISOString();
  const supabase = await createClient();

  const { error } = await supabase
    .from('memories')
    .update({ status: 'confirmed', confirmed_at: now, last_confirmed_at: now })
    .eq('id', parsed.data.id)
    // Guard the transition: only a suggestion can be confirmed, so a replayed
    // request cannot re-confirm and reset the original confirmation date.
    .eq('status', 'suggested');

  if (error) return { ok: false, error: 'Could not confirm that memory.' };

  await logAction({
    toolName: 'memory.confirm_save',
    operationType: 'execute',
    actionSummary: 'Confirmed a suggested memory',
    status: 'success',
  });

  revalidatePath('/memory');
  return { ok: true };
}

/** Reject a suggestion. Soft delete, so it stays recoverable. */
export async function rejectSuggestion(formData: FormData): Promise<ActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That memory could not be identified.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('memories')
    .update({ status: 'deleted', deleted_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('status', 'suggested');

  if (error) return { ok: false, error: 'Could not dismiss that suggestion.' };

  revalidatePath('/memory');
  return { ok: true };
}

const editMemorySchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
});

/**
 * Edit a memory.
 *
 * The prior content is written to `memory_versions` by a database trigger, not
 * here — an edit cannot skip the audit trail by going around this function.
 */
export async function editMemory(formData: FormData): Promise<ActionResult> {
  await requireOwner();

  const parsed = editMemorySchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title'),
    content: formData.get('content'),
  });

  if (!parsed.success) {
    const { message, fields } = formatValidationError(parsed.error);
    return { ok: false, error: message, fields };
  }

  const { id, ...changes } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase
    .from('memories')
    .update({
      ...changes,
      // Content changed, so the stored embedding no longer describes it.
      // Clearing it re-queues the row for the backfill job rather than leaving
      // a vector that would match the OLD text.
      embedding: null,
      embedding_attempts: 0,
    })
    .eq('id', id);

  if (error) return { ok: false, error: 'Could not update that memory.' };

  revalidatePath('/memory');
  return { ok: true };
}

/** Soft delete. Recoverable from version history. */
export async function deleteMemory(formData: FormData): Promise<ActionResult> {
  await requireOwner();

  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, error: 'That memory could not be identified.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('memories')
    .update({ status: 'deleted', deleted_at: new Date().toISOString() })
    .eq('id', parsed.data.id);

  if (error) return { ok: false, error: 'Could not delete that memory.' };

  await logAction({
    toolName: 'memory.delete',
    operationType: 'execute',
    actionSummary: 'Deleted a memory',
    status: 'success',
  });

  revalidatePath('/memory');
  return { ok: true };
}
