import { z } from 'zod';

import { approveAndExecuteApproval } from '@/lib/atlas/approvals/service';
import { AtlasPermissionLevel } from '@/lib/atlas/permissions/levels';
import {
  ideaDeletePayloadSchema,
  type IdeaDeletePayload,
  planExecutionPayloadSchema,
  type PlanExecutionPayload,
} from '@/lib/atlas/planner/model';
import {
  addIdeaNote,
  archiveIdea,
  completeIdea,
  completeIdeaStep,
  executeIdeaDeletion,
  executeIdeaPlan,
  proposeIdeaDeletion,
  proposeIdeaPlan,
  restoreIdea,
} from '@/lib/atlas/planner/service';
import { runAndStoreResearch } from '@/lib/atlas/research/service';
import { getTool, registerTool, type AtlasTool } from '@/lib/atlas/tools/registry';
import { createReminder, disableReminder, listReminders } from '@/lib/data/reminders';
import { listMemories } from '@/lib/data/memories';
import { getSettings } from '@/lib/data/settings';
import { getRelevantLearningContext, recordLearningObservation } from '@/lib/data/evolution';
import { captureIdea, getIdeaDetail, listIdeas } from '@/lib/data/ideas';
import { listTasks } from '@/lib/data/tasks';
import { createEvent, listEvents } from '@/lib/google/calendar';
import { createDraft, searchMessages } from '@/lib/google/gmail';
import { createClient } from '@/lib/supabase/server';
import {
  ATLAS_DEFAULT_TIMEZONE,
  localDateKey,
  zonedTimeToUtc,
} from '@/lib/time';
import { createReminderSchema, createTaskSchema } from '@/lib/validation/schemas';
import type { LearningItem } from '@/types/database';

/**
 * Concrete tool definitions.
 *
 * Registration is explicit and happens once, here. A tool absent from this
 * file does not exist, whatever a model emits.
 *
 * Every Level 2 tool supplies `describeProposal` so the approval card can show
 * a human-readable summary alongside the exact payload.
 */

const isoString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be a valid ISO 8601 timestamp');

const timeZoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Must be a valid IANA timezone');

/* -------------------------------------------------------------------- Tasks */

const tasksListSchema = z.object({ limit: z.number().int().min(1).max(50).default(20) });

const tasksList: AtlasTool<z.infer<typeof tasksListSchema>, unknown> = {
  name: 'tasks.list',
  description: 'List current Atlas tasks, including their IDs, status, priority and due time.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: tasksListSchema,
  async execute(_context, input) {
    const tasks = (await listTasks()).slice(0, input.limit).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueAt: task.due_at,
    }));
    return { ok: true, output: tasks, summary: `Read ${tasks.length} task(s)` };
  },
};

const taskCreateSchema = createTaskSchema.pick({
  title: true,
  description: true,
  priority: true,
  due_at: true,
});

const tasksCreate: AtlasTool<z.infer<typeof taskCreateSchema>, unknown> = {
  name: 'tasks.create',
  description: 'Create an internal Atlas task. This is reversible and visible on the Tasks page.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: taskCreateSchema,
  async execute(context, input) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('tasks')
      .insert({ ...input, source: 'voice', status: 'inbox', user_id: context.userId })
      .select('id,title,status,priority,due_at')
      .single();

    if (error || !data) {
      return { ok: false, errorCode: error?.code ?? 'insert_failed', message: 'The task could not be created.' };
    }

    return { ok: true, output: data, summary: `Created task "${input.title}"` };
  },
};

const taskCompleteSchema = z.object({ taskId: z.uuid() });

const tasksComplete: AtlasTool<z.infer<typeof taskCompleteSchema>, unknown> = {
  name: 'tasks.complete',
  description: 'Mark one Atlas task complete using the exact ID returned by tasks.list.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: taskCompleteSchema,
  async execute(_context, input) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', input.taskId)
      .is('deleted_at', null)
      .select('id,title,idea_id,idea_step_id')
      .maybeSingle();

    if (error || !data) {
      return { ok: false, errorCode: error?.code ?? 'not_found', message: 'That task could not be found or completed.' };
    }
    if (data.idea_id && data.idea_step_id) {
      const linked = await completeIdeaStep(data.idea_id, data.idea_step_id);
      if (!linked.ok) return linked;
    }
    return { ok: true, output: data, summary: `Completed task "${data.title}"` };
  },
};

/* ---------------------------------------------------------------- Reminders */

const remindersListSchema = z.object({ limit: z.number().int().min(1).max(50).default(20) });

const remindersList: AtlasTool<z.infer<typeof remindersListSchema>, unknown> = {
  name: 'reminders.list',
  description: 'List Atlas reminders with their IDs, schedule, timezone and status.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: remindersListSchema,
  async execute(_context, input) {
    const reminders = (await listReminders()).slice(0, input.limit).map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      remindAt: reminder.remind_at,
      nextTriggerAt: reminder.next_trigger_at,
      recurrenceRule: reminder.recurrence_rule,
      timezone: reminder.timezone,
      status: reminder.status,
    }));
    return { ok: true, output: reminders, summary: `Read ${reminders.length} reminder(s)` };
  },
};

const reminderCreateSchema = createReminderSchema.pick({
  title: true,
  description: true,
  remind_at: true,
  recurrence_rule: true,
  timezone: true,
});

const remindersCreate: AtlasTool<z.infer<typeof reminderCreateSchema>, unknown> = {
  name: 'reminders.create',
  description: 'Create an internal Atlas reminder at an exact ISO timestamp in an IANA timezone.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: reminderCreateSchema,
  async execute(_context, input) {
    try {
      const reminder = await createReminder({
        title: input.title,
        description: input.description,
        remindAt: input.remind_at,
        recurrenceRule: input.recurrence_rule ?? undefined,
        timezone: input.timezone,
        deliveryChannel: 'in_app',
      });
      return {
        ok: true,
        output: { id: reminder.id, title: reminder.title, remindAt: reminder.remind_at },
        summary: `Created reminder "${input.title}"`,
      };
    } catch {
      return { ok: false, errorCode: 'insert_failed', message: 'The reminder could not be created.' };
    }
  },
};

const reminderDisableSchema = z.object({ reminderId: z.uuid() });

const remindersDisable: AtlasTool<z.infer<typeof reminderDisableSchema>, unknown> = {
  name: 'reminders.disable',
  description: 'Disable one reminder using the exact ID returned by reminders.list.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: reminderDisableSchema,
  async execute(_context, input) {
    try {
      await disableReminder(input.reminderId);
      return { ok: true, output: { id: input.reminderId }, summary: 'Disabled the reminder' };
    } catch {
      return { ok: false, errorCode: 'update_failed', message: 'The reminder could not be disabled.' };
    }
  },
};

/* -------------------------------------------------------------------- Ideas */

const ideasListSchema = z.object({ limit: z.number().int().min(1).max(50).default(20) });

const ideasList: AtlasTool<z.infer<typeof ideasListSchema>, unknown> = {
  name: 'ideas.list',
  description: 'List the ideas currently saved in the Atlas Ideas pipeline.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: ideasListSchema,
  async execute(_context, input) {
    const ideas = (await listIdeas()).slice(0, input.limit).map((idea) => ({
      id: idea.id,
      title: idea.title,
      originalCapture: idea.original_capture,
      summary: idea.summary,
      category: idea.category,
      status: idea.status,
      nextAction: idea.next_action,
      nextActionAt: idea.next_action_at,
      structuredPlan: idea.structured_plan,
      updatedAt: idea.last_touched_at,
    }));
    return { ok: true, output: ideas, summary: `Read ${ideas.length} saved idea(s)` };
  },
};

const ideaCaptureSchema = z.object({
  title: z.string().trim().min(1).max(200),
  originalCapture: z.string().trim().min(1).max(8000),
  summary: z.string().trim().min(1).max(4000).optional(),
  category: z.string().trim().min(1).max(80).optional(),
});

const ideasCapture: AtlasTool<z.infer<typeof ideaCaptureSchema>, unknown> = {
  name: 'ideas.capture',
  description: 'Save a user idea verbatim, then check Calendar and prepare its complete plan for approval.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: ideaCaptureSchema,
  async execute(context, input) {
    try {
      const idea = await captureIdea({
        title: input.title,
        capture: input.originalCapture,
        summary: input.summary,
        category: input.category,
      });

      await recordLearningObservation({
        userId: context.userId,
        kind: 'observation',
        category: 'projects',
        key: `idea:${idea.id}`,
        title: idea.title,
        summary: idea.summary ?? idea.original_capture,
        sourceType: 'voice',
        sourceReference: idea.id,
        explicit: true,
      }).catch(() => null);

      const plan = await proposeIdeaPlan({ userId: context.userId, ideaId: idea.id }).catch(() => ({
        ok: false as const,
        errorCode: 'planning_failed',
        message: 'Atlas could not prepare the plan yet. The original Idea is safely captured.',
      }));

      return {
        ok: true,
        output: {
          id: idea.id,
          title: idea.title,
          status: idea.status,
          ideaPath: `/ideas/${idea.id}`,
          ...(plan.ok
            ? { approvalId: plan.data.approval.id, plan: plan.data.payload }
            : { planningError: plan.message }),
        },
        summary: plan.ok
          ? `Captured idea “${idea.title}” and prepared its Calendar-checked plan for approval`
          : `Captured idea “${idea.title}”; planning needs attention: ${plan.message}`,
      };
    } catch {
      return { ok: false, errorCode: 'insert_failed', message: 'Atlas could not save that idea.' };
    }
  },
};

const ideaIdSchema = z.object({ ideaId: z.uuid() });

const ideasGet: AtlasTool<z.infer<typeof ideaIdSchema>, unknown> = {
  name: 'ideas.get',
  description: 'Read one Idea with its current plan, notes and linked records.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: ideaIdSchema,
  async execute(_context, input) {
    const detail = await getIdeaDetail(input.ideaId);
    if (!detail) return { ok: false, errorCode: 'not_found', message: 'That idea could not be found.' };
    return {
      ok: true,
      output: {
        idea: detail.idea,
        steps: detail.steps,
        notes: detail.notes,
        linkedTasks: detail.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
        linkedReminders: detail.reminders.map((reminder) => ({ id: reminder.id, title: reminder.title, status: reminder.status })),
      },
      summary: `Read Idea “${detail.idea.title}”`,
    };
  },
};

const proposePlanSchema = z.object({
  ideaId: z.uuid(),
  revisionInstruction: z.string().trim().min(1).max(4000).optional(),
  timeZone: timeZoneSchema.default(ATLAS_DEFAULT_TIMEZONE),
});

const ideasProposePlan: AtlasTool<z.infer<typeof proposePlanSchema>, unknown> = {
  name: 'ideas.propose_plan',
  description: 'Understand or revise an Idea, check Google Calendar, and prepare one complete plan approval. This creates no linked items yet.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: proposePlanSchema,
  async execute(context, input) {
    const result = await proposeIdeaPlan({
      userId: context.userId,
      ideaId: input.ideaId,
      revisionInstruction: input.revisionInstruction,
      timezone: input.timeZone,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      output: {
        approvalId: result.data.approval.id,
        plan: result.data.payload,
        ideaPath: `/ideas/${input.ideaId}`,
      },
      summary: 'Prepared the Idea plan and displayed it for approval',
    };
  },
};

const approvePlanSchema = z.object({ approvalId: z.uuid() });

const ideasApprovePlan: AtlasTool<z.infer<typeof approvePlanSchema>, unknown> = {
  name: 'ideas.approve_plan',
  description: 'Approve and execute one exact pending Idea plan only after the user explicitly says to approve the plan Atlas just presented.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: approvePlanSchema,
  async execute(_context, input) {
    const result = await approveAndExecuteApproval(input.approvalId, 'ideas.execute_plan');
    return result.ok
      ? { ok: true, output: { approvalId: input.approvalId }, summary: result.summary }
      : result;
  },
};

const addIdeaNoteSchema = z.object({
  ideaId: z.uuid(),
  content: z.string().trim().min(1).max(8000),
});

const ideasAddNote: AtlasTool<z.infer<typeof addIdeaNoteSchema>, unknown> = {
  name: 'ideas.add_note',
  description: 'Add a lightweight note to one Idea. It remains separate from global Atlas Memory.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: addIdeaNoteSchema,
  async execute(context, input) {
    const result = await addIdeaNote(context.userId, input.ideaId, input.content);
    return result.ok ? { ok: true, output: result.data, summary: result.summary } : result;
  },
};

const completeIdeaStepSchema = z.object({ ideaId: z.uuid(), stepId: z.uuid() });

const ideasCompleteStep: AtlasTool<z.infer<typeof completeIdeaStepSchema>, unknown> = {
  name: 'ideas.complete_step',
  description: 'Complete one exact Idea step and its linked task after the user says it is done.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: completeIdeaStepSchema,
  async execute(_context, input) {
    const result = await completeIdeaStep(input.ideaId, input.stepId);
    return result.ok ? { ok: true, output: result.data, summary: result.summary } : result;
  },
};

const ideasComplete: AtlasTool<z.infer<typeof ideaIdSchema>, unknown> = {
  name: 'ideas.complete',
  description: 'Complete the whole Idea only after explicit confirmation and when all required steps are finished.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: ideaIdSchema,
  async execute(_context, input) {
    const result = await completeIdea(input.ideaId);
    return result.ok ? { ok: true, output: result.data, summary: result.summary } : result;
  },
};

const ideasArchive: AtlasTool<z.infer<typeof ideaIdSchema>, unknown> = {
  name: 'ideas.archive',
  description: 'Archive one Idea without changing its linked tasks, reminders or calendar events.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: ideaIdSchema,
  async execute(_context, input) {
    const result = await archiveIdea(input.ideaId);
    return result.ok ? { ok: true, output: result.data, summary: result.summary } : result;
  },
};

const ideasRestore: AtlasTool<z.infer<typeof ideaIdSchema>, unknown> = {
  name: 'ideas.restore',
  description: 'Restore one archived Idea to its previous status.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: ideaIdSchema,
  async execute(_context, input) {
    const result = await restoreIdea(input.ideaId);
    return result.ok ? { ok: true, output: result.data, summary: result.summary } : result;
  },
};

const proposeDeleteSchema = z.object({
  ideaId: z.uuid(),
  deleteLinkedTasks: z.boolean(),
  deleteLinkedReminders: z.boolean(),
  deleteLinkedCalendarEvents: z.boolean(),
});

const ideasProposeDelete: AtlasTool<z.infer<typeof proposeDeleteSchema>, unknown> = {
  name: 'ideas.propose_delete',
  description: 'Prepare permanent Idea deletion after the user explicitly chooses which linked items to remove. Deletes nothing yet.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: proposeDeleteSchema,
  async execute(context, input) {
    const result = await proposeIdeaDeletion({ userId: context.userId, ...input });
    return result.ok
      ? {
          ok: true,
          output: { approvalId: result.data.approval.id, approvalsPath: '/approvals' },
          summary: result.summary,
        }
      : result;
  },
};

const ideasExecutePlan: AtlasTool<PlanExecutionPayload, unknown> = {
  name: 'ideas.execute_plan',
  description: 'Create or revise all selected Tasks, Google Calendar blocks and Reminders in one approved plan.',
  permissionLevel: AtlasPermissionLevel.RequiresApproval,
  inputSchema: planExecutionPayloadSchema,
  describeProposal(input) {
    return {
      title: `Approve plan: ${input.ideaTitle}`,
      summary: `Creates or updates ${input.steps.length} plan step(s). Calendar changes run only after approval.`,
      affected: input.steps.map((step) => step.title),
    };
  },
  async execute(context, input) {
    const result = await executeIdeaPlan(context.userId, input, context.signal);
    return result.ok ? { ok: true, output: result.data, summary: result.summary } : result;
  },
};

const ideasExecuteDelete: AtlasTool<IdeaDeletePayload, unknown> = {
  name: 'ideas.execute_delete',
  description: 'Permanently delete one Idea and only the exact linked items selected in its approval.',
  permissionLevel: AtlasPermissionLevel.RequiresApproval,
  inputSchema: ideaDeletePayloadSchema,
  describeProposal(input) {
    return {
      title: `Delete idea: ${input.ideaTitle}`,
      summary: 'Permanently deletes the Idea. Selected linked items are visible in the exact payload.',
      affected: [
        `Idea: ${input.ideaTitle}`,
        ...(input.deleteLinkedTasks ? [`${input.linkedTaskIds.length} task(s)`] : []),
        ...(input.deleteLinkedReminders ? [`${input.linkedReminderIds.length} reminder(s)`] : []),
        ...(input.deleteLinkedCalendarEvents ? [`${input.linkedCalendarEventIds.length} calendar event(s)`] : []),
      ],
    };
  },
  async execute(context, input) {
    const result = await executeIdeaDeletion(context.userId, input, context.signal);
    return result.ok ? { ok: true, output: result.data, summary: result.summary } : result;
  },
};

/* ---------------------------------------------------------------- Calendar */

const listTodaySchema = z.object({ timeZone: timeZoneSchema.default(ATLAS_DEFAULT_TIMEZONE) });

const calendarListToday: AtlasTool<z.infer<typeof listTodaySchema>, unknown> = {
  name: 'calendar.list_today',
  description: "Today's calendar events.",
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: listTodaySchema,
  async execute(context, input) {
    const now = new Date();
    const [year, month, day] = localDateKey(now, input.timeZone).split('-').map(Number);
    const start = zonedTimeToUtc(year ?? 1970, month ?? 1, day ?? 1, 0, 0, input.timeZone);
    const nextDate = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));
    const end = zonedTimeToUtc(
      nextDate.getUTCFullYear(),
      nextDate.getUTCMonth() + 1,
      nextDate.getUTCDate(),
      0,
      0,
      input.timeZone,
    );

    const result = await listEvents(context.userId, start, end, input.timeZone, context.signal);
    if (!result.ok) return { ok: false, errorCode: result.errorCode, message: result.message };

    return {
      ok: true,
      output: result.data,
      summary: `Read ${result.data.length} calendar event(s) for today`,
    };
  },
};

const listRangeSchema = z.object({
  start: isoString,
  end: isoString,
  timeZone: timeZoneSchema.default(ATLAS_DEFAULT_TIMEZONE),
}).refine((value) => {
  const span = new Date(value.end).getTime() - new Date(value.start).getTime();
  return span > 0 && span <= 90 * 86_400_000;
}, { message: 'Calendar range must be positive and no longer than 90 days.' });

const calendarListRange: AtlasTool<z.infer<typeof listRangeSchema>, unknown> = {
  name: 'calendar.list_range',
  description: 'Read Google Calendar commitments across a bounded range before planning or moving work.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: listRangeSchema,
  async execute(context, input) {
    const result = await listEvents(
      context.userId,
      new Date(input.start),
      new Date(input.end),
      input.timeZone,
      context.signal,
    );
    if (!result.ok) return { ok: false, errorCode: result.errorCode, message: result.message };
    return {
      ok: true,
      output: result.data.map((event) => ({
        id: event.id,
        summary: event.summary,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
      })),
      summary: `Read ${result.data.length} calendar commitment(s)`,
    };
  },
};

const createEventSchema = z.object({
  summary: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  start: isoString,
  end: isoString,
  timeZone: timeZoneSchema.default(ATLAS_DEFAULT_TIMEZONE),
  attendees: z.array(z.email()).max(20).optional(),
});

const calendarExecuteCreate: AtlasTool<z.infer<typeof createEventSchema>, unknown> = {
  name: 'calendar.execute_create',
  description: 'Create a Google Calendar event immediately at the user’s request.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: createEventSchema,
  async execute(context, input) {
    const result = await createEvent(context.userId, input, context.signal);
    if (!result.ok) return { ok: false, errorCode: result.errorCode, message: result.message };
    return { ok: true, output: result.data, summary: `Created calendar event "${input.summary}"` };
  },
};

/* ------------------------------------------------------------------- Memory */

const memorySearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(8),
});

const memorySearch: AtlasTool<z.infer<typeof memorySearchSchema>, unknown> = {
  name: 'memory.search',
  description:
    'Search confirmed Atlas memories before answering questions about the user, their preferences, goals, people, projects, decisions, commitments, or prior plans.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: memorySearchSchema,
  async execute(_context, input) {
    const settings = await getSettings();
    if (settings?.memory_enabled === false) {
      return { ok: false, errorCode: 'memory_disabled', message: 'Memory is turned off in Settings.' };
    }

    const [memories, learned] = await Promise.all([
      listMemories({ status: 'confirmed', search: input.query, limit: input.limit }),
      getRelevantLearningContext(input.query, Math.min(input.limit, 6)).catch(() => []),
    ]);
    const confirmed = memories
      .map((memory) => ({
        id: memory.id,
        title: memory.title,
        content: memory.content,
        category: memory.category,
        sensitivity: memory.sensitivity,
        updatedAt: memory.updated_at,
      }));

    return {
      ok: true,
      output: {
        confirmedMemories: confirmed,
        learnedContext: learned.map((item) => ({ id: item.id, title: item.title, summary: item.summary, category: item.category, confidence: item.confidence, status: item.status })),
      },
      summary: `Found ${confirmed.length} confirmed memories and ${learned.length} relevant learned item(s)`,
    };
  },
};

const memoryRememberSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
  category: z.enum([
    'profile',
    'preference',
    'goal',
    'routine',
    'important_person',
    'project',
    'commitment',
    'decision',
    'idea_reference',
  ]),
  sensitivity: z.enum(['normal', 'personal', 'sensitive', 'highly_sensitive']).default('normal'),
});

const memoryRemember: AtlasTool<z.infer<typeof memoryRememberSchema>, unknown> = {
  name: 'memory.remember',
  description:
    'Save a stable fact the user stated, or a goal, decision, commitment, project, or plan the user explicitly agreed with Atlas. Do not save guesses, credentials, authentication codes, financial account numbers, or transient small talk.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: memoryRememberSchema,
  async execute(context, input) {
    const settings = await getSettings();
    if (settings?.memory_enabled === false) {
      return { ok: false, errorCode: 'memory_disabled', message: 'Memory is turned off in Settings.' };
    }

    const now = new Date().toISOString();
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from('memories')
      .select('id,title,category')
      .eq('title', input.title)
      .eq('content', input.content)
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      return { ok: true, output: existing, summary: `Already remembered “${input.title}”` };
    }

    const { data, error } = await supabase
      .from('memories')
      .insert({
        user_id: context.userId,
        title: input.title,
        content: input.content,
        category: input.category,
        sensitivity: input.sensitivity,
        status: 'confirmed',
        confidence: 1,
        source_type: 'voice',
        confirmed_at: now,
        last_confirmed_at: now,
      })
      .select('id,title,category')
      .single();

    if (error || !data) {
      return { ok: false, errorCode: error?.code ?? 'insert_failed', message: 'Atlas could not save that memory.' };
    }

    const learningCategory = {
      profile: 'facts', preference: 'preferences', goal: 'goals', routine: 'routines',
      important_person: 'people', project: 'projects', commitment: 'goals', decision: 'decisions',
      idea_reference: 'projects',
    } as const;
    // Best-effort sidecar. The confirmed memory save above remains successful
    // even if learning is paused or the evolution migration is not yet live.
    await recordLearningObservation({
      userId: context.userId,
      kind: input.category === 'decision' ? 'decision' : 'confirmed_memory',
      category: learningCategory[input.category],
      key: `memory:${input.category}:${input.title}`,
      title: input.title,
      summary: input.content,
      sourceType: 'voice',
      sourceReference: data.id,
      explicit: true,
    }).catch(() => null);

    return { ok: true, output: data, summary: `Remembered “${input.title}”` };
  },
};

const learningFeedbackSchema = z.object({
  learningItemId: z.uuid(),
  feedback: z.enum(['useful', 'not_useful', 'confirm', 'correct', 'dismiss']),
  correctedSummary: z.string().trim().min(1).max(2000).optional(),
}).refine((value) => value.feedback !== 'correct' || Boolean(value.correctedSummary), {
  message: 'A correction needs the corrected information.',
  path: ['correctedSummary'],
});

const learningFeedback: AtlasTool<z.infer<typeof learningFeedbackSchema>, unknown> = {
  name: 'learning.feedback',
  description: 'Record the user’s explicit correction or confirmation of a learned item returned by memory.search.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: learningFeedbackSchema,
  async execute(context, input) {
    const supabase = await createClient();
    const { data: item } = await supabase.from('learning_items').select('*').eq('id', input.learningItemId).maybeSingle();
    if (!item) return { ok: false, errorCode: 'not_found', message: 'That learned item could not be found.' };
    if (input.feedback === 'correct') {
      if (!input.correctedSummary) return { ok: false, errorCode: 'invalid_correction', message: 'Please state the corrected information.' };
      const replacement = await recordLearningObservation({
        userId: context.userId,
        kind: item.kind,
        category: item.category,
        key: `correction:${item.canonical_key}:${input.correctedSummary}`,
        title: item.title,
        summary: input.correctedSummary,
        sourceType: 'feedback',
        sourceReference: item.id,
        explicit: true,
      });
      if (!replacement) return { ok: false, errorCode: 'unsafe_or_failed', message: 'Atlas could not safely save that correction.' };
      await supabase.from('learning_items').update({ status: 'superseded', superseded_by: replacement.id }).eq('id', item.id);
      await supabase.from('learning_feedback').insert({ user_id: context.userId, learning_item_id: item.id, feedback_type: 'correct', source: 'voice' });
      return { ok: true, output: { id: replacement.id }, summary: 'Corrected the learned item and retained its history' };
    }
    const changes: Partial<LearningItem> = input.feedback === 'confirm'
      ? { user_confirmed: true, status: item.kind === 'workflow' ? 'active' : 'confirmed', confidence: 1 }
      : input.feedback === 'dismiss'
        ? { status: 'dismissed', feedback_score: item.feedback_score - 1 }
        : { confidence: Math.max(0, Math.min(1, item.confidence + (input.feedback === 'useful' ? 0.1 : -0.2))), feedback_score: item.feedback_score + (input.feedback === 'useful' ? 1 : -1) };
    const { error } = await supabase.from('learning_items').update(changes).eq('id', input.learningItemId);
    if (error) return { ok: false, errorCode: error.code, message: 'Atlas could not save that correction.' };
    await supabase.from('learning_feedback').insert({ user_id: context.userId, learning_item_id: input.learningItemId, feedback_type: input.feedback, source: 'voice' });
    return { ok: true, output: { id: input.learningItemId }, summary: 'Updated Atlas learning from your feedback' };
  },
};

/* ----------------------------------------------------------------- Research */

const researchCurrentSchema = z.object({
  query: z.string().trim().min(3).max(1000),
});

const researchCurrent: AtlasTool<z.infer<typeof researchCurrentSchema>, unknown> = {
  name: 'research.current_web',
  description:
    'Research current information using live Google-grounded sources, save the report, and return a concise sourced summary.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: researchCurrentSchema,
  async execute(context, input) {
    try {
      const result = await runAndStoreResearch(context.userId, input.query);
      return {
        ok: true,
        output: {
          reportId: result.reportId,
          summary: result.summary,
          sources: result.sources,
          unverified: result.unverified,
          caveat: result.caveat,
          researchPath: '/research',
        },
        summary: `Completed research with ${result.sources.length} grounded source(s)`,
      };
    } catch {
      return { ok: false, errorCode: 'research_failed', message: 'Atlas could not complete that research.' };
    }
  },
};

/* ------------------------------------------------------------------- Gmail */

const gmailSearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  maxResults: z.number().int().min(1).max(25).default(10),
});

const gmailSearch: AtlasTool<z.infer<typeof gmailSearchSchema>, unknown> = {
  name: 'gmail.search',
  description: 'Search Gmail. Returns metadata and snippets only, never full bodies.',
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: gmailSearchSchema,
  async execute(context, input) {
    const result = await searchMessages(context.userId, input.query, input.maxResults, context.signal);
    if (!result.ok) return { ok: false, errorCode: result.errorCode, message: result.message };
    return { ok: true, output: result.data, summary: `Searched Gmail, ${result.data.length} result(s)` };
  },
};

const draftSchema = z.object({
  to: z.email(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  threadId: z.string().trim().optional(),
});

const gmailExecuteCreateDraft: AtlasTool<z.infer<typeof draftSchema>, unknown> = {
  name: 'gmail.execute_create_draft',
  description: 'Create an approved Gmail draft. Never sends.',
  permissionLevel: AtlasPermissionLevel.RequiresApproval,
  inputSchema: draftSchema,
  describeProposal(input) {
    return {
      title: `Draft a reply to ${input.to}`,
      // The recipient is stated explicitly: if it came from email content it
      // is attacker-controlled, and this is where that becomes visible.
      summary: `Creates a DRAFT in Gmail to ${input.to}, subject "${input.subject}". It is not sent.`,
      affected: ['Gmail drafts'],
    };
  },
  async execute(context, input) {
    const result = await createDraft(context.userId, input, context.signal);
    if (!result.ok) return { ok: false, errorCode: result.errorCode, message: result.message };
    return { ok: true, output: result.data, summary: `Created a Gmail draft to ${input.to}` };
  },
};

/* -------------------------------------------------------------- Registration */

/**
 * Idempotent: safe to call from any entry point.
 *
 * The guard asks the REGISTRY whether the tools are present rather than
 * tracking a separate boolean. A module-level flag can desync from the thing
 * it guards — clearing the registry would leave the flag set and every
 * subsequent registration silently skipped.
 */
export function registerAllTools(): void {
  if (getTool('calendar.list_today')) return;

  registerTool(tasksList);
  registerTool(tasksCreate);
  registerTool(tasksComplete);
  registerTool(remindersList);
  registerTool(remindersCreate);
  registerTool(remindersDisable);
  registerTool(ideasList);
  registerTool(ideasCapture);
  registerTool(ideasGet);
  registerTool(ideasProposePlan);
  registerTool(ideasApprovePlan);
  registerTool(ideasAddNote);
  registerTool(ideasCompleteStep);
  registerTool(ideasComplete);
  registerTool(ideasArchive);
  registerTool(ideasRestore);
  registerTool(ideasProposeDelete);
  registerTool(ideasExecutePlan);
  registerTool(ideasExecuteDelete);
  registerTool(memorySearch);
  registerTool(memoryRemember);
  registerTool(learningFeedback);
  registerTool(researchCurrent);
  registerTool(calendarListToday);
  registerTool(calendarListRange);
  registerTool(calendarExecuteCreate);
  registerTool(gmailSearch);
  registerTool(gmailExecuteCreateDraft);
}
