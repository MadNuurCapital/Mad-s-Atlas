import { z } from 'zod';

import { parseRecurrence } from '@/lib/scheduling/recurrence';

/**
 * Input schemas for everything that crosses a trust boundary.
 *
 * Every server action and route handler validates through one of these before
 * touching the database. Nothing is coerced into something plausible — invalid
 * input is refused, because silently "fixing" a malformed date is how a
 * reminder ends up firing on the wrong day.
 */

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** An ISO timestamp that is actually parseable, not merely string-shaped. */
const isoTimestamp = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be a valid ISO 8601 timestamp');

const recurrenceRule = z
  .string()
  .trim()
  .refine((v) => {
    try {
      parseRecurrence(v);
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid RFC 5545 RRULE, for example FREQ=WEEKLY;BYDAY=MO,WE,FR');

/** IANA zone names only — validated by asking Intl, not by a regex. */
const timezone = z.string().trim().refine((v) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, 'Must be a valid IANA timezone name, for example Asia/Singapore');

/* -------------------------------------------------------------------------- */
/*  Tasks                                                                      */
/* -------------------------------------------------------------------------- */

export const taskStatusSchema = z.enum([
  'inbox',
  'planned',
  'in_progress',
  'waiting',
  'completed',
  'cancelled',
]);

export const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

export const createTaskSchema = z.object({
  title: trimmed(200),
  description: z.string().trim().max(4000).optional(),
  status: taskStatusSchema.default('inbox'),
  priority: taskPrioritySchema.default('normal'),
  due_at: isoTimestamp.nullable().optional(),
  start_at: isoTimestamp.nullable().optional(),
  related_project: z.string().trim().max(120).optional(),
  source: z.enum(['manual', 'voice', 'email', 'briefing', 'idea']).default('manual'),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  id: z.uuid(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/* -------------------------------------------------------------------------- */
/*  Reminders                                                                  */
/* -------------------------------------------------------------------------- */

export const createReminderSchema = z.object({
  title: trimmed(200),
  description: z.string().trim().max(4000).optional(),
  remind_at: isoTimestamp,
  recurrence_rule: recurrenceRule.nullable().optional(),
  timezone: timezone.default('Asia/Singapore'),
  // In-app is the honest default until a browser push subscription exists.
  delivery_channel: z.enum(['push', 'in_app', 'calendar']).default('in_app'),
  related_task_id: z.uuid().nullable().optional(),
});

export const updateReminderSchema = createReminderSchema.partial().extend({
  id: z.uuid(),
});

export type CreateReminderInput = z.infer<typeof createReminderSchema>;

/* -------------------------------------------------------------------------- */
/*  Ideas                                                                      */
/* -------------------------------------------------------------------------- */

export const ideaStatusSchema = z.enum([
  'captured',
  'exploring',
  'planned',
  'building',
  'completed',
  'parked',
  'archived',
]);

export const createIdeaSchema = z.object({
  title: trimmed(200),
  // Preserved verbatim — Atlas may summarise it, never overwrite it.
  original_capture: trimmed(8000),
  category: z.string().trim().max(80).optional(),
  status: ideaStatusSchema.default('captured'),
});

export const updateIdeaSchema = z.object({
  id: z.uuid(),
  title: trimmed(200).optional(),
  summary: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(80).optional(),
  status: ideaStatusSchema.optional(),
  next_action: z.string().trim().max(500).optional(),
});

/* -------------------------------------------------------------------------- */
/*  Settings and profile                                                       */
/* -------------------------------------------------------------------------- */

export const updateSettingsSchema = z.object({
  memory_enabled: z.boolean().optional(),
  proactive_briefings_enabled: z.boolean().optional(),
  email_summary_enabled: z.boolean().optional(),
  calendar_preparation_enabled: z.boolean().optional(),
  notification_enabled: z.boolean().optional(),
  conversation_retention_days: z.number().int().min(1).max(365).optional(),
  research_detail_level: z.enum(['brief', 'standard', 'detailed']).optional(),
  approval_expiry_minutes: z.number().int().min(5).max(1440).optional(),
  meeting_prep_lead_minutes: z.number().int().min(5).max(240).optional(),
});

export const updateProfileSchema = z.object({
  display_name: z.string().trim().max(120).optional(),
  preferred_name: z.string().trim().max(80).optional(),
  timezone: timezone.optional(),
  briefing_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a 24-hour time such as 09:00')
    .optional(),
  briefing_enabled: z.boolean().optional(),
});

/* -------------------------------------------------------------------------- */
/*  Shared                                                                     */
/* -------------------------------------------------------------------------- */

export const idSchema = z.object({ id: z.uuid() });

/**
 * Normalise a Zod failure into something a person can act on.
 * Field paths are included; submitted values never are.
 */
export function formatValidationError(error: z.ZodError): {
  message: string;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    fields[path] ??= issue.message;
  }

  const first = Object.entries(fields)[0];
  return {
    message: first ? `${first[0]}: ${first[1]}` : 'That input was not valid.',
    fields,
  };
}
