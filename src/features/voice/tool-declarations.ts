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
    name: 'calendar.list_today',
    description: "Read today's Google Calendar events.",
    parameters: {
      type: 'object',
      properties: { timeZone: { type: 'string', description: 'IANA timezone.' } },
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
