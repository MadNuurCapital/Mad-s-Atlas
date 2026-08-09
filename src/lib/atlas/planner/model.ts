import { z } from 'zod';

export const plannerStepDraftSchema = z.object({
  existingStepId: z.uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().default(null),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  scheduledStart: z.string().datetime({ offset: true }).nullable().default(null),
  createTask: z.boolean().default(true),
  createCalendarBlock: z.boolean().default(true),
  createReminder: z.boolean().default(true),
});

export const plannerConstraintsSchema = z.object({
  earliestDate: z.string().date().nullable().default(null),
  latestDate: z.string().date().nullable().default(null),
  avoidWeekdays: z.array(z.enum([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ])).max(7).default([]),
  preferredStartHour: z.number().int().min(0).max(23).nullable().default(null),
  preferredEndHour: z.number().int().min(1).max(24).nullable().default(null),
});

export const plannerDraftSchema = z.object({
  understanding: z.string().trim().min(1).max(4000),
  instructions: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  assumptions: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  constraints: plannerConstraintsSchema,
  steps: z.array(plannerStepDraftSchema).min(1).max(20),
});

export type PlannerDraft = z.infer<typeof plannerDraftSchema>;
export type PlannerStepDraft = z.infer<typeof plannerStepDraftSchema>;

export const ideaCommandSchema = z.object({
  action: z.enum([
    'revise_plan',
    'add_note',
    'complete_step',
    'complete_idea',
    'archive',
    'restore',
    'delete_review',
    'show_next',
    'unknown',
  ]),
  stepId: z.uuid().nullable().default(null),
  note: z.string().trim().max(8000).nullable().default(null),
  explanation: z.string().trim().max(500).default(''),
});

export type IdeaCommand = z.infer<typeof ideaCommandSchema>;

export type BusyInterval = { start: string; end: string };

export const planExecutionPayloadSchema = z.object({
  ideaId: z.uuid(),
  ideaTitle: z.string().trim().min(1).max(200),
  planVersion: z.number().int().min(1),
  understanding: z.string().trim().min(1).max(4000),
  instructions: z.array(z.string().trim().min(1).max(1000)).max(30),
  assumptions: z.array(z.string().trim().min(1).max(1000)).max(20),
  steps: z.array(plannerStepDraftSchema).min(1).max(20),
  supersededStepIds: z.array(z.uuid()).max(50),
});

export type PlanExecutionPayload = z.infer<typeof planExecutionPayloadSchema>;

export const ideaDeletePayloadSchema = z.object({
  ideaId: z.uuid(),
  ideaTitle: z.string().trim().min(1).max(200),
  deleteLinkedTasks: z.boolean(),
  deleteLinkedReminders: z.boolean(),
  deleteLinkedCalendarEvents: z.boolean(),
  linkedTaskIds: z.array(z.uuid()).max(100),
  linkedReminderIds: z.array(z.uuid()).max(100),
  linkedCalendarEventIds: z.array(z.string().trim().min(1).max(1024)).max(100),
});

export type IdeaDeletePayload = z.infer<typeof ideaDeletePayloadSchema>;
