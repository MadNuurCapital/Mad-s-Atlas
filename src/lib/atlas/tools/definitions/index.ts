import { z } from 'zod';

import { AtlasPermissionLevel } from '@/lib/atlas/permissions/levels';
import { getTool, registerTool, type AtlasTool } from '@/lib/atlas/tools/registry';
import { createEvent, listEvents } from '@/lib/google/calendar';
import { createDraft, searchMessages } from '@/lib/google/gmail';
import { ATLAS_DEFAULT_TIMEZONE } from '@/lib/time';

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

/* ---------------------------------------------------------------- Calendar */

const listTodaySchema = z.object({ timeZone: z.string().default(ATLAS_DEFAULT_TIMEZONE) });

const calendarListToday: AtlasTool<z.infer<typeof listTodaySchema>, unknown> = {
  name: 'calendar.list_today',
  description: "Today's calendar events.",
  permissionLevel: AtlasPermissionLevel.Automatic,
  inputSchema: listTodaySchema,
  async execute(context, input) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const result = await listEvents(context.userId, start, end, input.timeZone);
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
  timeZone: z.string().default(ATLAS_DEFAULT_TIMEZONE),
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
    const result = await createEvent(context.userId, input);
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
    const result = await searchMessages(context.userId, input.query, input.maxResults);
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
    const result = await createDraft(context.userId, input);
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

  registerTool(calendarListToday);
  registerTool(calendarExecuteCreate);
  registerTool(gmailSearch);
  registerTool(gmailExecuteCreateDraft);
}
