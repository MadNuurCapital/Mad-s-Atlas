import 'server-only';

import { createApproval } from '@/lib/atlas/approvals/service';
import {
  generatePlannerDraft,
  interpretIdeaCommand,
} from '@/lib/atlas/planner/provider';
import { schedulePlanSteps } from '@/lib/atlas/planner/scheduling';
import type {
  IdeaCommand,
  IdeaDeletePayload,
  PlanExecutionPayload,
  PlannerStepDraft,
} from '@/lib/atlas/planner/model';
import { getIdeaDetail, type IdeaDetail } from '@/lib/data/ideas';
import { deletePlanEvent, listEvents, upsertPlanEvent } from '@/lib/google/calendar';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ATLAS_DEFAULT_TIMEZONE } from '@/lib/time';
import type { Approval, Idea, IdeaStatus, IdeaStep, Json } from '@/types/database';

export type PlannerServiceResult<T> =
  | { ok: true; data: T; summary: string }
  | { ok: false; errorCode: string; message: string };

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function scheduledEnd(step: PlannerStepDraft): string | null {
  if (!step.scheduledStart) return null;
  return new Date(new Date(step.scheduledStart).getTime() + step.durationMinutes * 60_000).toISOString();
}

function validExistingStepIds(detail: IdeaDetail, steps: PlannerStepDraft[]): boolean {
  const allowed = new Set(
    detail.steps
      .filter((step) => step.status !== 'completed' && step.status !== 'skipped')
      .map((step) => step.id),
  );
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.existingStepId) continue;
    if (!allowed.has(step.existingStepId) || seen.has(step.existingStepId)) return false;
    seen.add(step.existingStepId);
  }
  return true;
}

export async function proposeIdeaPlan(input: {
  userId: string;
  ideaId: string;
  revisionInstruction?: string;
  timezone?: string;
}): Promise<PlannerServiceResult<{ approval: Approval; payload: PlanExecutionPayload }>> {
  const detail = await getIdeaDetail(input.ideaId);
  if (!detail) return { ok: false, errorCode: 'not_found', message: 'That idea could not be found.' };
  if (detail.idea.status === 'archived') {
    return { ok: false, errorCode: 'archived', message: 'Restore this idea before planning it.' };
  }

  const now = new Date();
  const timezone = input.timezone ?? ATLAS_DEFAULT_TIMEZONE;
  const calendar = await listEvents(input.userId, now, addDays(now, 90), timezone);
  if (!calendar.ok) {
    return {
      ok: false,
      errorCode: calendar.errorCode,
      message: `Atlas must check your calendar before proposing dates. ${calendar.message}`,
    };
  }

  const busy = calendar.data
    .filter((event) => event.start && event.end)
    .map((event) => ({ start: event.start, end: event.end }));

  let draft;
  try {
    draft = await generatePlannerDraft({
      idea: detail.idea,
      steps: detail.steps,
      notes: detail.notes,
      busy,
      timezone,
      now: now.toISOString(),
      revisionInstruction: input.revisionInstruction,
    });
  } catch {
    return {
      ok: false,
      errorCode: 'planning_failed',
      message: 'Atlas could not prepare a reliable plan. Your original idea is still safely captured.',
    };
  }

  const steps = schedulePlanSteps({ draft, busy, now, timezone });
  if (!validExistingStepIds(detail, steps)) {
    return {
      ok: false,
      errorCode: 'invalid_step_reference',
      message: 'Atlas produced an unsafe step reference, so the proposal was refused.',
    };
  }

  const retained = new Set(steps.flatMap((step) => (step.existingStepId ? [step.existingStepId] : [])));
  const supersededStepIds = detail.steps
    .filter(
      (step) =>
        step.status !== 'completed' &&
        step.status !== 'skipped' &&
        !retained.has(step.id),
    )
    .map((step) => step.id);
  const planVersion = detail.idea.plan_version + 1;
  const payload: PlanExecutionPayload = {
    ideaId: detail.idea.id,
    ideaTitle: detail.idea.title,
    planVersion,
    understanding: draft.understanding,
    instructions: draft.instructions,
    assumptions: draft.assumptions,
    steps,
    supersededStepIds,
  };

  const supabase = await createClient();
  const next = steps[0] ?? null;
  const { data: savedDraft, error: draftError } = await supabase
    .from('ideas')
    .update({
      understanding: draft.understanding,
      instructions: draft.instructions as Json,
      structured_plan: payload as unknown as Json,
      plan_version: planVersion,
      next_action: next?.title ?? null,
      next_action_at: next?.scheduledStart ?? null,
      next_action_duration_minutes: next?.durationMinutes ?? null,
      last_touched_at: now.toISOString(),
    })
    .eq('id', detail.idea.id)
    .eq('plan_version', detail.idea.plan_version)
    .select('id')
    .maybeSingle();

  if (draftError || !savedDraft) {
    if (!draftError) {
      return {
        ok: false,
        errorCode: 'plan_changed',
        message: 'This Idea changed while Atlas was planning. Open it and try again.',
      };
    }
    return { ok: false, errorCode: draftError.code, message: 'Atlas could not save the plan draft.' };
  }

  try {
    const approval = await createApproval({
      userId: input.userId,
      actionType: 'ideas.execute_plan',
      title: `Approve plan: ${detail.idea.title}`,
      reason: `Create ${steps.length} planned step${steps.length === 1 ? '' : 's'} after checking Google Calendar.`,
      payload,
      affected: steps.flatMap((step) => [
        ...(step.createTask ? [`Task: ${step.title}`] : []),
        ...(step.createCalendarBlock && step.scheduledStart ? [`Calendar: ${step.title}`] : []),
        ...(step.createReminder && step.scheduledStart ? [`Reminder: ${step.title}`] : []),
      ]),
      externalSystem: steps.some((step) => step.createCalendarBlock) ? 'Google Calendar' : null,
      expiryMinutes: 7 * 24 * 60,
    });

    // A replacement exists before older proposals close. The version check
    // already makes those older payloads unexecutable during this short gap.
    const admin = createAdminClient();
    await admin
      .from('approvals')
      .update({ status: 'rejected', rejected_at: now.toISOString() })
      .eq('user_id', input.userId)
      .eq('action_type', 'ideas.execute_plan')
      .eq('status', 'pending')
      .contains('proposed_payload', { ideaId: detail.idea.id })
      .neq('id', approval.id);

    await supabase
      .from('ideas')
      .update({ pending_approval_id: approval.id })
      .eq('id', detail.idea.id)
      .eq('plan_version', planVersion);

    return { ok: true, data: { approval, payload }, summary: 'Prepared a calendar-checked plan for approval' };
  } catch {
    return { ok: false, errorCode: 'approval_failed', message: 'The plan was drafted but its approval could not be created.' };
  }
}

async function updateNextAction(ideaId: string): Promise<void> {
  const supabase = await createClient();
  const { data: next } = await supabase
    .from('idea_steps')
    .select('*')
    .eq('idea_id', ideaId)
    .in('status', ['pending', 'in_progress'])
    .order('scheduled_start', { ascending: true, nullsFirst: false })
    .order('position')
    .limit(1)
    .maybeSingle();

  await supabase
    .from('ideas')
    .update({
      next_action: next?.title ?? null,
      next_action_at: next?.scheduled_start ?? null,
      next_action_duration_minutes: next?.duration_minutes ?? null,
      last_touched_at: new Date().toISOString(),
    })
    .eq('id', ideaId);
}

export async function executeIdeaPlan(
  userId: string,
  payload: PlanExecutionPayload,
  signal?: AbortSignal,
): Promise<PlannerServiceResult<{ ideaId: string; created: number; updated: number }>> {
  const detail = await getIdeaDetail(payload.ideaId);
  if (!detail) return { ok: false, errorCode: 'not_found', message: 'That idea could not be found.' };
  if (detail.idea.plan_version !== payload.planVersion) {
    return {
      ok: false,
      errorCode: 'stale_plan',
      message: 'This plan was revised after it was approved. Review the newest version instead.',
    };
  }

  const supabase = await createClient();
  let created = 0;
  let updated = 0;

  for (let position = 0; position < payload.steps.length; position += 1) {
    const proposed = payload.steps[position];
    if (!proposed) continue;
    const end = scheduledEnd(proposed);
    let step: IdeaStep | null = proposed.existingStepId
      ? (detail.steps.find((candidate) => candidate.id === proposed.existingStepId) ?? null)
      : null;

    if (step?.status === 'completed') continue;

    if (step) {
      const { data, error } = await supabase
        .from('idea_steps')
        .update({
          position,
          title: proposed.title,
          description: proposed.description,
          duration_minutes: proposed.durationMinutes,
          scheduled_start: proposed.scheduledStart,
          scheduled_end: end,
          plan_version: payload.planVersion,
          needs_attention_at: null,
          notify_upcoming: proposed.createReminder,
          notify_execute: proposed.createReminder,
          notify_plan_check: proposed.createReminder,
          upcoming_notified_at: null,
          execute_notified_at: null,
          plan_check_notified_at: null,
        })
        .eq('id', step.id)
        .select()
        .single();
      if (error || !data) return { ok: false, errorCode: error?.code ?? 'step_update_failed', message: `Could not update “${proposed.title}”.` };
      step = data as IdeaStep;
      updated += 1;
    } else {
      const { data, error } = await supabase
        .from('idea_steps')
        .insert({
          user_id: userId,
          idea_id: payload.ideaId,
          position,
          title: proposed.title,
          description: proposed.description,
          duration_minutes: proposed.durationMinutes,
          scheduled_start: proposed.scheduledStart,
          scheduled_end: end,
          plan_version: payload.planVersion,
          status: 'pending',
          notify_upcoming: proposed.createReminder,
          notify_execute: proposed.createReminder,
          notify_plan_check: proposed.createReminder,
        })
        .select()
        .single();
      if (error || !data) return { ok: false, errorCode: error?.code ?? 'step_create_failed', message: `Could not create “${proposed.title}”.` };
      step = data as IdeaStep;
      created += 1;
    }

    let taskId = step.task_id;
    if (proposed.createTask) {
      const taskPayload = {
        title: proposed.title,
        description: proposed.description,
        status: 'planned' as const,
        priority: 'normal' as const,
        due_at: end,
        start_at: proposed.scheduledStart,
        source: 'idea' as const,
        related_project: payload.ideaTitle,
        idea_id: payload.ideaId,
        idea_step_id: step.id,
        needs_attention_at: null,
      };
      if (taskId) {
        const { error } = await supabase.from('tasks').update(taskPayload).eq('id', taskId);
        if (error) return { ok: false, errorCode: error.code, message: `Could not update the task for “${proposed.title}”.` };
      } else {
        const { data, error } = await supabase
          .from('tasks')
          .insert({ ...taskPayload, user_id: userId })
          .select('id')
          .single();
        if (error || !data) return { ok: false, errorCode: error?.code ?? 'task_create_failed', message: `Could not create the task for “${proposed.title}”.` };
        taskId = data.id;
      }
    } else if (taskId) {
      await supabase
        .from('tasks')
        .update({ status: 'cancelled', completed_at: null })
        .eq('id', taskId)
        .neq('status', 'completed');
    }

    let calendarEventId = step.google_calendar_event_id;
    if (proposed.createCalendarBlock && proposed.scheduledStart && end) {
      const event = await upsertPlanEvent(userId, step.id, {
        summary: proposed.title,
        description: `Atlas plan: ${payload.ideaTitle}\nOpen: /ideas/${payload.ideaId}`,
        start: proposed.scheduledStart,
        end,
        timeZone: ATLAS_DEFAULT_TIMEZONE,
      }, signal);
      if (!event.ok) return { ok: false, errorCode: event.errorCode, message: event.message };
      calendarEventId = event.data.eventId;
      if (taskId) {
        await supabase.from('tasks').update({ google_calendar_event_id: calendarEventId }).eq('id', taskId);
      }
    } else if (calendarEventId) {
      const removed = await deletePlanEvent(userId, calendarEventId, signal);
      if (!removed.ok) return { ok: false, errorCode: removed.errorCode, message: removed.message };
      calendarEventId = null;
    }

    let reminderId = step.reminder_id;
    if (proposed.createReminder && proposed.scheduledStart) {
      const reminderAt = new Date(
        Math.max(Date.now(), new Date(proposed.scheduledStart).getTime() - 15 * 60_000),
      ).toISOString();
      const reminderPayload = {
        title: `Upcoming: ${proposed.title}`,
        description: `Your Atlas plan session starts in 15 minutes.`,
        remind_at: reminderAt,
        next_trigger_at: reminderAt,
        timezone: ATLAS_DEFAULT_TIMEZONE,
        delivery_channel: 'push' as const,
        status: 'scheduled' as const,
        related_task_id: taskId,
        google_calendar_event_id: calendarEventId,
        idea_id: payload.ideaId,
        idea_step_id: step.id,
      };
      if (reminderId) {
        const { error } = await supabase.from('reminders').update(reminderPayload).eq('id', reminderId);
        if (error) return { ok: false, errorCode: error.code, message: `Could not update the reminder for “${proposed.title}”.` };
      } else {
        const { data, error } = await supabase
          .from('reminders')
          .insert({ ...reminderPayload, user_id: userId })
          .select('id')
          .single();
        if (error || !data) return { ok: false, errorCode: error?.code ?? 'reminder_create_failed', message: `Could not create the reminder for “${proposed.title}”.` };
        reminderId = data.id;
      }
    } else if (reminderId) {
      await supabase.from('reminders').update({ status: 'disabled' }).eq('id', reminderId);
    }

    await supabase
      .from('idea_steps')
      .update({ task_id: taskId, reminder_id: reminderId, google_calendar_event_id: calendarEventId })
      .eq('id', step.id);
  }

  for (const stepId of payload.supersededStepIds) {
    const old = detail.steps.find((step) => step.id === stepId);
    if (!old || old.status === 'completed') continue;
    if (old.google_calendar_event_id) {
      const removed = await deletePlanEvent(userId, old.google_calendar_event_id, signal);
      if (!removed.ok) return { ok: false, errorCode: removed.errorCode, message: removed.message };
    }
    if (old.task_id) {
      await supabase.from('tasks').update({ status: 'cancelled', completed_at: null }).eq('id', old.task_id).neq('status', 'completed');
    }
    if (old.reminder_id) await supabase.from('reminders').update({ status: 'disabled' }).eq('id', old.reminder_id);
    await supabase
      .from('idea_steps')
      .update({ status: 'skipped', google_calendar_event_id: null })
      .eq('id', old.id);
  }

  const hasCompleted = detail.steps.some((step) => step.status === 'completed');
  await supabase
    .from('ideas')
    .update({
      status: hasCompleted ? 'in_progress' : 'planned',
      understanding: payload.understanding,
      instructions: payload.instructions as Json,
      approved_at: new Date().toISOString(),
      pending_approval_id: null,
      last_touched_at: new Date().toISOString(),
    })
    .eq('id', payload.ideaId)
    .eq('plan_version', payload.planVersion);
  await updateNextAction(payload.ideaId);

  return {
    ok: true,
    data: { ideaId: payload.ideaId, created, updated },
    summary: `Activated plan “${payload.ideaTitle}” with ${payload.steps.length} step(s)`,
  };
}

export async function addIdeaNote(
  userId: string,
  ideaId: string,
  content: string,
): Promise<PlannerServiceResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('idea_notes')
    .insert({ user_id: userId, idea_id: ideaId, content: content.trim() })
    .select('id')
    .single();
  if (error || !data) return { ok: false, errorCode: error?.code ?? 'note_failed', message: 'Atlas could not save that note.' };
  return { ok: true, data: { id: data.id }, summary: 'Added the note to this Idea only' };
}

export async function completeIdeaStep(
  ideaId: string,
  stepId: string,
): Promise<PlannerServiceResult<{ nextAction: string | null }>> {
  const detail = await getIdeaDetail(ideaId);
  const step = detail?.steps.find((candidate) => candidate.id === stepId);
  if (!detail || !step) return { ok: false, errorCode: 'not_found', message: 'That plan step could not be found.' };
  if (step.status === 'completed') {
    return { ok: true, data: { nextAction: detail.idea.next_action }, summary: 'That step was already completed' };
  }

  const now = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from('idea_steps')
    .update({ status: 'completed', completed_at: now, needs_attention_at: null })
    .eq('id', stepId)
    .eq('idea_id', ideaId);
  if (error) return { ok: false, errorCode: error.code, message: 'Atlas could not complete that step.' };

  if (step.task_id) {
    await supabase
      .from('tasks')
      .update({ status: 'completed', completed_at: now, needs_attention_at: null })
      .eq('id', step.task_id);
  }
  if (step.reminder_id) await supabase.from('reminders').update({ status: 'completed' }).eq('id', step.reminder_id);
  await supabase
    .from('ideas')
    .update({ status: 'in_progress', last_touched_at: now })
    .eq('id', ideaId)
    .neq('status', 'archived');
  await updateNextAction(ideaId);

  const refreshed = await getIdeaDetail(ideaId);
  return {
    ok: true,
    data: { nextAction: refreshed?.idea.next_action ?? null },
    summary: `Completed “${step.title}”`,
  };
}

export async function completeIdea(ideaId: string): Promise<PlannerServiceResult<{ id: string }>> {
  const detail = await getIdeaDetail(ideaId);
  if (!detail) return { ok: false, errorCode: 'not_found', message: 'That idea could not be found.' };
  const unfinished = detail.steps.filter((step) => step.required && !['completed', 'skipped'].includes(step.status));
  if (unfinished.length > 0) {
    return { ok: false, errorCode: 'steps_remaining', message: `${unfinished.length} required step${unfinished.length === 1 ? '' : 's'} still need attention.` };
  }
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('ideas')
    .update({ status: 'completed', completed_at: now, archived_at: null, next_action: null, next_action_at: null, next_action_duration_minutes: null, last_touched_at: now })
    .eq('id', ideaId);
  if (error) return { ok: false, errorCode: error.code, message: 'Atlas could not complete that plan.' };
  return { ok: true, data: { id: ideaId }, summary: `Completed plan “${detail.idea.title}”` };
}

export async function archiveIdea(ideaId: string): Promise<PlannerServiceResult<{ id: string }>> {
  const detail = await getIdeaDetail(ideaId);
  if (!detail) return { ok: false, errorCode: 'not_found', message: 'That idea could not be found.' };
  if (detail.idea.status === 'archived') return { ok: true, data: { id: ideaId }, summary: 'That idea is already archived' };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('ideas')
    .update({
      archived_from_status: detail.idea.status,
      status: 'archived',
      archived_at: now,
      completed_at: null,
      last_touched_at: now,
    })
    .eq('id', ideaId);
  if (error) return { ok: false, errorCode: error.code, message: 'Atlas could not archive that idea.' };
  return { ok: true, data: { id: ideaId }, summary: `Archived “${detail.idea.title}”` };
}

export async function restoreIdea(ideaId: string): Promise<PlannerServiceResult<{ id: string }>> {
  const detail = await getIdeaDetail(ideaId);
  if (!detail) return { ok: false, errorCode: 'not_found', message: 'That idea could not be found.' };
  if (detail.idea.status !== 'archived') return { ok: true, data: { id: ideaId }, summary: 'That idea is already active' };
  const restored = detail.idea.archived_from_status ?? (detail.steps.length ? 'planned' : 'captured');
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('ideas')
    .update({
      status: restored,
      archived_at: null,
      archived_from_status: null,
      completed_at: restored === 'completed' ? now : null,
      last_touched_at: now,
    })
    .eq('id', ideaId);
  if (error) return { ok: false, errorCode: error.code, message: 'Atlas could not restore that idea.' };
  return { ok: true, data: { id: ideaId }, summary: `Restored “${detail.idea.title}”` };
}

export async function interpretCommand(command: string, detail: IdeaDetail): Promise<PlannerServiceResult<IdeaCommand>> {
  try {
    const parsed = await interpretIdeaCommand({ command, idea: detail.idea, steps: detail.steps });
    return { ok: true, data: parsed, summary: parsed.explanation || 'Understood the Idea update' };
  } catch {
    return { ok: false, errorCode: 'command_failed', message: 'Atlas could not safely understand that update. Try being more specific.' };
  }
}

export async function proposeIdeaDeletion(input: {
  userId: string;
  ideaId: string;
  deleteLinkedTasks: boolean;
  deleteLinkedReminders: boolean;
  deleteLinkedCalendarEvents: boolean;
}): Promise<PlannerServiceResult<{ approval: Approval }>> {
  const detail = await getIdeaDetail(input.ideaId);
  if (!detail) return { ok: false, errorCode: 'not_found', message: 'That idea could not be found.' };
  const payload: IdeaDeletePayload = {
    ideaId: detail.idea.id,
    ideaTitle: detail.idea.title,
    deleteLinkedTasks: input.deleteLinkedTasks,
    deleteLinkedReminders: input.deleteLinkedReminders,
    deleteLinkedCalendarEvents: input.deleteLinkedCalendarEvents,
    linkedTaskIds: detail.tasks.map((task) => task.id),
    linkedReminderIds: detail.reminders.map((reminder) => reminder.id),
    linkedCalendarEventIds: [...new Set(detail.steps.flatMap((step) => step.google_calendar_event_id ? [step.google_calendar_event_id] : []))],
  };
  try {
    const approval = await createApproval({
      userId: input.userId,
      actionType: 'ideas.execute_delete',
      title: `Delete idea: ${detail.idea.title}`,
      reason: 'Permanently delete the Idea and only the linked items selected below.',
      payload,
      affected: [
        `Idea: ${detail.idea.title}`,
        ...(input.deleteLinkedTasks ? [`${payload.linkedTaskIds.length} linked task(s)`] : []),
        ...(input.deleteLinkedReminders ? [`${payload.linkedReminderIds.length} linked reminder(s)`] : []),
        ...(input.deleteLinkedCalendarEvents ? [`${payload.linkedCalendarEventIds.length} Google Calendar event(s)`] : []),
      ],
      externalSystem: input.deleteLinkedCalendarEvents ? 'Google Calendar' : null,
      expiryMinutes: 24 * 60,
    });
    return { ok: true, data: { approval }, summary: 'Prepared the deletion for explicit approval' };
  } catch {
    return { ok: false, errorCode: 'approval_failed', message: 'Atlas could not prepare that deletion safely.' };
  }
}

export async function executeIdeaDeletion(
  userId: string,
  payload: IdeaDeletePayload,
  signal?: AbortSignal,
): Promise<PlannerServiceResult<{ id: string }>> {
  const detail = await getIdeaDetail(payload.ideaId);
  if (!detail) return { ok: true, data: { id: payload.ideaId }, summary: 'The Idea was already deleted' };

  const currentTasks = new Set(detail.tasks.map((task) => task.id));
  const currentReminders = new Set(detail.reminders.map((reminder) => reminder.id));
  const currentEvents = new Set(detail.steps.flatMap((step) => step.google_calendar_event_id ? [step.google_calendar_event_id] : []));
  if (
    payload.linkedTaskIds.length !== currentTasks.size ||
    payload.linkedReminderIds.length !== currentReminders.size ||
    payload.linkedCalendarEventIds.length !== currentEvents.size ||
    payload.linkedTaskIds.some((id) => !currentTasks.has(id)) ||
    payload.linkedReminderIds.some((id) => !currentReminders.has(id)) ||
    payload.linkedCalendarEventIds.some((id) => !currentEvents.has(id))
  ) {
    return { ok: false, errorCode: 'links_changed', message: 'Linked items changed after approval. Review the deletion again.' };
  }

  if (payload.deleteLinkedCalendarEvents) {
    for (const eventId of payload.linkedCalendarEventIds) {
      const removed = await deletePlanEvent(userId, eventId, signal);
      if (!removed.ok) return { ok: false, errorCode: removed.errorCode, message: removed.message };
    }
  }

  const supabase = await createClient();
  if (payload.deleteLinkedReminders && payload.linkedReminderIds.length) {
    const { error } = await supabase.from('reminders').delete().in('id', payload.linkedReminderIds);
    if (error) return { ok: false, errorCode: error.code, message: 'Linked reminders could not be removed.' };
  }
  if (payload.deleteLinkedTasks && payload.linkedTaskIds.length) {
    const { error } = await supabase.from('tasks').delete().in('id', payload.linkedTaskIds);
    if (error) return { ok: false, errorCode: error.code, message: 'Linked tasks could not be removed.' };
  }
  const { error } = await supabase.from('ideas').delete().eq('id', payload.ideaId);
  if (error) return { ok: false, errorCode: error.code, message: 'The Idea could not be deleted.' };
  return { ok: true, data: { id: payload.ideaId }, summary: `Deleted Idea “${payload.ideaTitle}”` };
}

export function ideaStatusAfterRestore(idea: Idea): IdeaStatus {
  return idea.archived_from_status ?? 'captured';
}
