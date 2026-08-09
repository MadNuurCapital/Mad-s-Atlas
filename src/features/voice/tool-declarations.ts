/**
 * Client-visible descriptions only. The server registry remains the authority:
 * advertising a function here can never make an unregistered function run.
 */
export const VOICE_FUNCTION_DECLARATIONS = [
  {
    name: 'tasks.list',
    description: 'List current tasks before answering task questions or locating a task to complete.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
    },
  },
  {
    name: 'tasks.create',
    description: 'Create a reversible internal Atlas task. Convert spoken local times to ISO 8601 first.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title.' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
        due_at: { type: 'string', description: 'ISO 8601 instant including an offset.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'tasks.complete',
    description: 'Complete a task. Call tasks.list first and use the exact matching ID; never guess an ID.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'UUID from tasks.list.' } },
      required: ['taskId'],
    },
  },
  {
    name: 'reminders.list',
    description: 'List current reminders before answering reminder questions or locating one to disable.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
    },
  },
  {
    name: 'reminders.create',
    description: 'Create an internal Atlas reminder. Resolve relative times using the current time and user timezone.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        remind_at: { type: 'string', description: 'ISO 8601 instant including an offset.' },
        recurrence_rule: { type: 'string', description: 'Optional RFC 5545 RRULE.' },
        timezone: { type: 'string', description: 'IANA timezone, normally Asia/Singapore.' },
      },
      required: ['title', 'remind_at'],
    },
  },
  {
    name: 'reminders.disable',
    description: 'Disable a reminder. Call reminders.list first and use the exact matching ID.',
    parameters: {
      type: 'object',
      properties: { reminderId: { type: 'string', description: 'UUID from reminders.list.' } },
      required: ['reminderId'],
    },
  },
  {
    name: 'ideas.list',
    description: 'List captured Atlas ideas before answering what ideas the user has saved or planned.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
    },
  },
  {
    name: 'ideas.capture',
    description: 'Persist an Idea verbatim, check Calendar, and return its complete plan proposal for approval.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short, faithful title for the idea.' },
        originalCapture: { type: 'string', description: 'The user’s idea in their original wording. Do not rewrite it.' },
        summary: { type: 'string', description: 'Optional faithful one-sentence summary.' },
        category: { type: 'string', description: 'Optional short category.' },
      },
      required: ['title', 'originalCapture'],
    },
  },
  {
    name: 'ideas.get',
    description: 'Read one exact Idea, its plan, notes and linked records before changing or answering about it.',
    parameters: {
      type: 'object',
      properties: { ideaId: { type: 'string', description: 'Exact UUID from ideas.list or ideas.capture.' } },
      required: ['ideaId'],
    },
  },
  {
    name: 'ideas.propose_plan',
    description: 'Understand, improve, plan or re-plan one Idea. Checks Google Calendar and creates one proposal for approval; does not execute it.',
    parameters: {
      type: 'object',
      properties: {
        ideaId: { type: 'string', description: 'Exact Idea UUID.' },
        revisionInstruction: { type: 'string', description: 'For re-planning, copy the user’s requested change faithfully.' },
        timeZone: { type: 'string', description: 'IANA timezone, normally Asia/Singapore.' },
      },
      required: ['ideaId'],
    },
  },
  {
    name: 'ideas.approve_plan',
    description: 'Approve and execute the exact pending Idea plan Atlas just presented. Call only after the user explicitly says yes or approve.',
    parameters: {
      type: 'object',
      properties: { approvalId: { type: 'string', description: 'Exact UUID returned by ideas.propose_plan.' } },
      required: ['approvalId'],
    },
  },
  {
    name: 'ideas.add_note',
    description: 'Add a note to one Idea only. Do not also save it to global Memory unless separately requested.',
    parameters: {
      type: 'object',
      properties: {
        ideaId: { type: 'string' },
        content: { type: 'string', description: 'The note content in the user’s wording.' },
      },
      required: ['ideaId', 'content'],
    },
  },
  {
    name: 'ideas.complete_step',
    description: 'Mark one exact plan step and its linked task done after the user explicitly says it is finished.',
    parameters: {
      type: 'object',
      properties: { ideaId: { type: 'string' }, stepId: { type: 'string' } },
      required: ['ideaId', 'stepId'],
    },
  },
  {
    name: 'ideas.complete',
    description: 'Complete a whole Idea only after all required steps are done and the user confirms completion.',
    parameters: {
      type: 'object',
      properties: { ideaId: { type: 'string' } },
      required: ['ideaId'],
    },
  },
  {
    name: 'ideas.archive',
    description: 'Archive one Idea without changing linked Tasks, Reminders or Calendar events.',
    parameters: {
      type: 'object',
      properties: { ideaId: { type: 'string' } },
      required: ['ideaId'],
    },
  },
  {
    name: 'ideas.restore',
    description: 'Restore one archived Idea.',
    parameters: {
      type: 'object',
      properties: { ideaId: { type: 'string' } },
      required: ['ideaId'],
    },
  },
  {
    name: 'ideas.propose_delete',
    description: 'Only after explicit confirmation, prepare permanent Idea deletion and the user’s exact choices for linked Tasks, Reminders and Calendar events.',
    parameters: {
      type: 'object',
      properties: {
        ideaId: { type: 'string' },
        deleteLinkedTasks: { type: 'boolean' },
        deleteLinkedReminders: { type: 'boolean' },
        deleteLinkedCalendarEvents: { type: 'boolean' },
      },
      required: ['ideaId', 'deleteLinkedTasks', 'deleteLinkedReminders', 'deleteLinkedCalendarEvents'],
    },
  },
  {
    name: 'calendar.list_today',
    description: "Read today's Google Calendar events.",
    parameters: {
      type: 'object',
      properties: { timeZone: { type: 'string', description: 'IANA timezone.' } },
    },
  },
  {
    name: 'calendar.list_range',
    description: 'Read Google Calendar commitments for a bounded range before planning or moving work.',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ISO 8601 range start.' },
        end: { type: 'string', description: 'ISO 8601 range end, no more than 90 days later.' },
        timeZone: { type: 'string' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'calendar.execute_create',
    description: 'Create a Google Calendar event immediately when the user asks Atlas to add it.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        description: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 start including an offset.' },
        end: { type: 'string', description: 'ISO 8601 end including an offset.' },
        timeZone: { type: 'string', description: 'IANA timezone.' },
        attendees: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    name: 'memory.search',
    description: 'Search what Atlas remembers before answering about the user or a previous plan, preference, goal, person, project, decision, or commitment.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Concise description of the memory to retrieve.' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory.remember',
    description: 'Save a stable user fact or an explicitly agreed goal, decision, commitment, project, or plan. Never save guesses, passwords, authentication codes, or financial account numbers.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short label for the memory.' },
        content: { type: 'string', description: 'The exact useful fact or agreed plan, stated without speculation.' },
        category: {
          type: 'string',
          enum: ['profile', 'preference', 'goal', 'routine', 'important_person', 'project', 'commitment', 'decision', 'idea_reference'],
        },
        sensitivity: { type: 'string', enum: ['normal', 'personal', 'sensitive', 'highly_sensitive'] },
      },
      required: ['title', 'content', 'category'],
    },
  },
  {
    name: 'learning.feedback',
    description: 'Confirm, correct, dismiss or rate a learned item returned by memory.search when the user explicitly gives feedback.',
    parameters: {
      type: 'object',
      properties: {
        learningItemId: { type: 'string', description: 'UUID returned by memory.search.' },
        feedback: { type: 'string', enum: ['useful', 'not_useful', 'confirm', 'correct', 'dismiss'] },
        correctedSummary: { type: 'string', description: 'Required only for a correction; the accurate replacement.' },
      },
      required: ['learningItemId', 'feedback'],
    },
  },
  {
    name: 'research.current_web',
    description: 'Research a current topic using live grounded sources and save the resulting report in Research.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The complete current-information research question.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail.search',
    description: 'Search Gmail and return metadata plus short snippets, never full message bodies.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A Gmail search query.' },
        maxResults: { type: 'integer', minimum: 1, maximum: 25 },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail.execute_create_draft',
    description: 'Propose a Gmail draft. This creates an Atlas approval only and can never send email.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        threadId: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
] as const;
