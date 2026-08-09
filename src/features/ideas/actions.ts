'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  addIdeaNote,
  archiveIdea,
  completeIdea,
  completeIdeaStep,
  interpretCommand,
  proposeIdeaDeletion,
  proposeIdeaPlan,
  restoreIdea,
} from '@/lib/atlas/planner/service';
import { requireOwner } from '@/lib/auth/owner';
import { captureIdea, getIdeaDetail } from '@/lib/data/ideas';
import { createClient } from '@/lib/supabase/server';
import { idSchema } from '@/lib/validation/schemas';

export type IdeaActionResult =
  | {
      ok: true;
      message: string;
      ideaId?: string;
      approvalId?: string;
      requiresDeleteReview?: boolean;
    }
  | { ok: false; error: string };

const captureSchema = z.object({
  title: z.string().trim().min(1).max(200),
  originalCapture: z.string().trim().min(1).max(8000),
});

const ideaIdSchema = z.object({ ideaId: z.uuid() });
const noteSchema = z.object({ ideaId: z.uuid(), content: z.string().trim().min(1).max(8000) });
const noteEditSchema = noteSchema.extend({ noteId: z.uuid() }).omit({ ideaId: true });
const commandSchema = z.object({ ideaId: z.uuid(), command: z.string().trim().min(1).max(4000) });

function refreshIdea(ideaId?: string) {
  revalidatePath('/ideas');
  if (ideaId) revalidatePath(`/ideas/${ideaId}`);
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/reminders');
  revalidatePath('/approvals');
}

export async function captureIdeaAction(formData: FormData): Promise<IdeaActionResult> {
  const { user } = await requireOwner();
  const parsed = captureSchema.safeParse({
    title: formData.get('title'),
    originalCapture: formData.get('originalCapture'),
  });
  if (!parsed.success) return { ok: false, error: 'Add a title and describe the idea.' };

  try {
    const idea = await captureIdea({ title: parsed.data.title, capture: parsed.data.originalCapture });
    const plan = await proposeIdeaPlan({ userId: user.id, ideaId: idea.id }).catch(() => ({
      ok: false as const,
      errorCode: 'planning_failed',
      message: 'Atlas could not prepare the plan yet. The original Idea is safely captured.',
    }));
    refreshIdea(idea.id);
    return {
      ok: true,
      message: plan.ok
        ? 'Idea captured. Atlas checked your calendar and prepared the complete plan for approval.'
        : `Idea captured safely, but planning needs attention: ${plan.message}`,
      ideaId: idea.id,
      approvalId: plan.ok ? plan.data.approval.id : undefined,
    };
  } catch {
    return { ok: false, error: 'Atlas could not capture that idea. Please try again.' };
  }
}

export async function proposePlanAction(formData: FormData): Promise<IdeaActionResult> {
  const { user } = await requireOwner();
  const parsed = ideaIdSchema.safeParse({ ideaId: formData.get('ideaId') });
  if (!parsed.success) return { ok: false, error: 'That idea could not be identified.' };
  const revision = String(formData.get('revisionInstruction') ?? '').trim() || undefined;
  const result = await proposeIdeaPlan({ userId: user.id, ideaId: parsed.data.ideaId, revisionInstruction: revision });
  refreshIdea(parsed.data.ideaId);
  return result.ok
    ? {
        ok: true,
        message: 'Atlas checked your calendar and prepared one complete plan for approval.',
        ideaId: parsed.data.ideaId,
        approvalId: result.data.approval.id,
      }
    : { ok: false, error: result.message };
}

export async function addNoteAction(formData: FormData): Promise<IdeaActionResult> {
  const { user } = await requireOwner();
  const parsed = noteSchema.safeParse({ ideaId: formData.get('ideaId'), content: formData.get('content') });
  if (!parsed.success) return { ok: false, error: 'Write a note before saving.' };
  const result = await addIdeaNote(user.id, parsed.data.ideaId, parsed.data.content);
  refreshIdea(parsed.data.ideaId);
  return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
}

export async function editNoteAction(formData: FormData): Promise<IdeaActionResult> {
  await requireOwner();
  const parsed = noteEditSchema.safeParse({ noteId: formData.get('noteId'), content: formData.get('content') });
  const ideaId = String(formData.get('ideaId') ?? '');
  if (!parsed.success || !z.uuid().safeParse(ideaId).success) return { ok: false, error: 'That note is not valid.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('idea_notes')
    .update({ content: parsed.data.content })
    .eq('id', parsed.data.noteId)
    .eq('idea_id', ideaId);
  if (error) return { ok: false, error: 'Atlas could not update that note.' };
  refreshIdea(ideaId);
  return { ok: true, message: 'Note updated.' };
}

export async function deleteNoteAction(formData: FormData): Promise<IdeaActionResult> {
  await requireOwner();
  const parsed = idSchema.safeParse({ id: formData.get('noteId') });
  const ideaId = String(formData.get('ideaId') ?? '');
  if (!parsed.success || !z.uuid().safeParse(ideaId).success) return { ok: false, error: 'That note could not be identified.' };
  const supabase = await createClient();
  const { error } = await supabase.from('idea_notes').delete().eq('id', parsed.data.id).eq('idea_id', ideaId);
  if (error) return { ok: false, error: 'Atlas could not delete that note.' };
  refreshIdea(ideaId);
  return { ok: true, message: 'Note deleted.' };
}

export async function completeStepAction(formData: FormData): Promise<IdeaActionResult> {
  await requireOwner();
  const parsed = z.object({ ideaId: z.uuid(), stepId: z.uuid() }).safeParse({
    ideaId: formData.get('ideaId'),
    stepId: formData.get('stepId'),
  });
  if (!parsed.success) return { ok: false, error: 'That plan step could not be identified.' };
  const result = await completeIdeaStep(parsed.data.ideaId, parsed.data.stepId);
  refreshIdea(parsed.data.ideaId);
  return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
}

export async function completeIdeaAction(formData: FormData): Promise<IdeaActionResult> {
  await requireOwner();
  const parsed = ideaIdSchema.safeParse({ ideaId: formData.get('ideaId') });
  if (!parsed.success) return { ok: false, error: 'That idea could not be identified.' };
  const result = await completeIdea(parsed.data.ideaId);
  refreshIdea(parsed.data.ideaId);
  return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
}

export async function archiveIdeaAction(formData: FormData): Promise<IdeaActionResult> {
  await requireOwner();
  const parsed = ideaIdSchema.safeParse({ ideaId: formData.get('ideaId') });
  if (!parsed.success) return { ok: false, error: 'That idea could not be identified.' };
  const result = await archiveIdea(parsed.data.ideaId);
  refreshIdea(parsed.data.ideaId);
  return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
}

export async function restoreIdeaAction(formData: FormData): Promise<IdeaActionResult> {
  await requireOwner();
  const parsed = ideaIdSchema.safeParse({ ideaId: formData.get('ideaId') });
  if (!parsed.success) return { ok: false, error: 'That idea could not be identified.' };
  const result = await restoreIdea(parsed.data.ideaId);
  refreshIdea(parsed.data.ideaId);
  return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
}

export async function keepIdeaAction(formData: FormData): Promise<IdeaActionResult> {
  await requireOwner();
  const parsed = ideaIdSchema.safeParse({ ideaId: formData.get('ideaId') });
  if (!parsed.success) return { ok: false, error: 'That idea could not be identified.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('ideas')
    .update({ last_touched_at: new Date().toISOString() })
    .eq('id', parsed.data.ideaId);
  if (error) return { ok: false, error: 'Atlas could not keep that idea active.' };
  refreshIdea(parsed.data.ideaId);
  return { ok: true, message: 'Idea kept. Cleanup will check again after another 90 quiet days.' };
}

/** Native server-form adapters intentionally discard the rich client result. */
export async function archiveIdeaFormAction(formData: FormData): Promise<void> {
  await archiveIdeaAction(formData);
}

export async function keepIdeaFormAction(formData: FormData): Promise<void> {
  await keepIdeaAction(formData);
}

export async function proposeDeleteAction(formData: FormData): Promise<IdeaActionResult> {
  const { user } = await requireOwner();
  const parsed = ideaIdSchema.safeParse({ ideaId: formData.get('ideaId') });
  if (!parsed.success) return { ok: false, error: 'That idea could not be identified.' };
  const result = await proposeIdeaDeletion({
    userId: user.id,
    ideaId: parsed.data.ideaId,
    deleteLinkedTasks: formData.get('deleteLinkedTasks') === 'on',
    deleteLinkedReminders: formData.get('deleteLinkedReminders') === 'on',
    deleteLinkedCalendarEvents: formData.get('deleteLinkedCalendarEvents') === 'on',
  });
  refreshIdea(parsed.data.ideaId);
  return result.ok
    ? { ok: true, message: result.summary, approvalId: result.data.approval.id }
    : { ok: false, error: result.message };
}

export async function runIdeaCommandAction(formData: FormData): Promise<IdeaActionResult> {
  const { user } = await requireOwner();
  const parsed = commandSchema.safeParse({ ideaId: formData.get('ideaId'), command: formData.get('command') });
  if (!parsed.success) return { ok: false, error: 'Tell Atlas what you want to change.' };
  const detail = await getIdeaDetail(parsed.data.ideaId);
  if (!detail) return { ok: false, error: 'That idea could not be found.' };

  const interpretation = await interpretCommand(parsed.data.command, detail);
  if (!interpretation.ok) return { ok: false, error: interpretation.message };
  const command = interpretation.data;

  if (command.action === 'revise_plan') {
    const result = await proposeIdeaPlan({
      userId: user.id,
      ideaId: detail.idea.id,
      revisionInstruction: parsed.data.command,
    });
    refreshIdea(detail.idea.id);
    return result.ok
      ? { ok: true, message: 'Atlas re-planned the unfinished work and prepared the revised schedule for approval.', approvalId: result.data.approval.id }
      : { ok: false, error: result.message };
  }
  if (command.action === 'add_note' && command.note) {
    const result = await addIdeaNote(user.id, detail.idea.id, command.note);
    refreshIdea(detail.idea.id);
    return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
  }
  if (command.action === 'complete_step' && command.stepId) {
    const result = await completeIdeaStep(detail.idea.id, command.stepId);
    refreshIdea(detail.idea.id);
    return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
  }
  if (command.action === 'complete_idea') {
    const result = await completeIdea(detail.idea.id);
    refreshIdea(detail.idea.id);
    return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
  }
  if (command.action === 'archive') {
    const result = await archiveIdea(detail.idea.id);
    refreshIdea(detail.idea.id);
    return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
  }
  if (command.action === 'restore') {
    const result = await restoreIdea(detail.idea.id);
    refreshIdea(detail.idea.id);
    return result.ok ? { ok: true, message: result.summary } : { ok: false, error: result.message };
  }
  if (command.action === 'delete_review') {
    return { ok: true, message: 'Review the linked-item choices in Delete below before Atlas prepares the approval.', requiresDeleteReview: true };
  }
  if (command.action === 'show_next') {
    return { ok: true, message: detail.idea.next_action ? `Next: ${detail.idea.next_action}` : 'This Idea has no unfinished next action.' };
  }
  return { ok: false, error: 'Atlas needs a more specific instruction for this Idea.' };
}
