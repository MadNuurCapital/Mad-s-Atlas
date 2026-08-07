import { z } from 'zod';

import { AtlasPermissionLevel } from '@/lib/atlas/permissions/levels';
import { getTool, registerTool, type AtlasTool } from '@/lib/atlas/tools/registry';
import { createReminder, disableReminder, listReminders } from '@/lib/data/reminders';
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
      .select('id,title')
      .maybeSingle();

    if (error || !data) {
      return { ok: false, errorCode: error?.code ?? 'not_found', message: 'That task could not be found or completed.' };
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
  description: 'Create a calendar event that has been approved.',
  permissionLevel: AtlasPermissionLevel.RequiresApproval,
  inputSchema: createEventSchema,
  describeProposal(input) {
    return {
      title: `Add "${input.summary}" to your calendar`,
      summary:
        `Creates an event from ${input.start} to ${input.end} (${input.timeZone})` +
        (input.attendees?.length ? `, inviting ${input.attendees.length} attendee(s)` : ''),
      affected: ['Google Calendar (primary)'],
    };
  },
  async execute(context, input) {
    const result = await createEvent(context.userId, input, context.signal);
    if (!result.ok) return { ok: false, errorCode: result.errorCode, message: result.message };
    return { ok: true, output: result.data, summary: `Created calendar event "${input.summary}"` };
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
  registerTool(calendarListToday);
  registerTool(calendarExecuteCreate);
  registerTool(gmailSearch);
  registerTool(gmailExecuteCreateDraft);
}
