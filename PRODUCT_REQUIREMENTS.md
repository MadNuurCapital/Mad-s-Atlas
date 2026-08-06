# Product Requirements — Mad's Atlas

## Identity

**Product:** Mad's Atlas
**Owner:** Muhammad, also known as Mad. Sole user.
**Type:** Private personal AI operating system.

Mad's Atlas is a single-tenant application with exactly one authorised account.
It is not a product for other users, not a demo, and not a multi-tenant service
that happens to have one customer.

---

## Purpose

Mad's Atlas helps Muhammad:

- Understand and organise his day
- Talk naturally through realtime voice
- Research current information, with sources
- Review his calendar
- Search and summarise Gmail
- Prepare email drafts
- Capture tasks and reminders
- Save ideas
- Remember confirmed personal information
- Prepare before meetings
- Recommend the most important next action
- Carry out approved personal actions
- Maintain a clear history of what it has done

---

## Cross-system isolation

Mad's Atlas is **completely separate** from:

- Atlas DART
- Atlas Academy
- Atlas Investments
- Client-management systems
- Advisor-management systems
- Financial advisory databases
- Company databases

No connection, no import, no shared credentials, no shared database, no feature
that reads or writes them.

Mad's Atlas **may know these projects exist** — if, and only if, Muhammad saves
that fact as a personal memory. Knowing about a project is not access to it.

This isolation is enforced structurally: the application has no network path,
no credential and no code referencing any of those systems. It is not a policy
the model is asked to respect.

---

## Core operating principle

Every interaction follows one loop:

```
Listen
  → Understand the request
    → Retrieve relevant context
      → Select the correct tool
        → Check permissions
          → Perform or prepare the action
            → Return the result
              → Log the action
                → Save memory only when appropriate
```

The voice is only the interface. The product is the intelligence, memory,
tools, permissions and actions behind the voice.

Two consequences follow, and they shape the whole system:

1. **The model never holds authority.** It proposes; the server decides.
2. **Not everything said is worth remembering.** Memory is curated, not
   accumulated.

---

## Screens

| Route | Purpose |
|---|---|
| `/sign-in` | Google sign-in. The only unauthenticated route. |
| `/today` | Greeting, Singapore date/time, primary priority, calendar, tasks, reminders, important emails, pending approvals, daily briefing, quick voice button |
| `/talk` | Voice controls, live transcript, tool activity, sources, current context, pending approval prompts, text fallback |
| `/calendar` | Today, upcoming, meeting preparation, proposed changes |
| `/inbox` | Important emails, action-required emails, search, summaries, draft approvals |
| `/tasks` | Inbox, today, upcoming, overdue, completed |
| `/memory` | Confirmed, suggested, categories, search, edit, supersede, delete, export, delete all |
| `/ideas` | Captured, exploring, planned, building, completed, parked |
| `/approvals` | Pending, approved, rejected, expired, executed, failed |
| `/history` | Action log and tool runs, filterable |
| `/settings` | Profile, Google connection, Gemini status, voice, privacy, memory, notifications, briefing, meeting prep, retention, export, delete all |

---

## Capability boundaries

Full detail in [PERMISSIONS.md](./PERMISSIONS.md). In summary:

**Level 1 — automatic.** Reading and analysis. Calendar reads, Gmail search and
summary, confirmed-memory search, current web research, task and reminder
reads, recommendations, reports, meeting briefs, non-sensitive memory
suggestions.

**Level 2 — prepare and approve.** Anything with an external or lasting effect.
Gmail draft creation, calendar create/update, task deletion, sensitive memory
saves, sensitive edits, bulk changes, sensitive exports, new connections,
changes to proactive automation.

**Level 3 — not implemented.** Send email. Payments. Investments. Purchases.
Public publishing. Gmail deletion. OS control. Password access. External data
sharing. Any Atlas DART / Academy / Investments connection. Financial
transactions.

---

## Privacy commitments

These are defaults, not settings the user must find and enable:

- Raw microphone audio is **never** stored.
- Voice transcripts are session-only unless explicitly saved.
- Full Gmail bodies are **never** persisted.
- Email is **never** sent.
- Sensitive memory is **never** saved without explicit confirmation.
- Personal information is never shared externally or reused for unrelated
  prompts.
- Personal data never appears in logs.
- Full export is always available.
- Selective deletion and complete deletion are always available.
- What is stored, and for how long, is stated plainly in Settings → Privacy.

See [DATA_RETENTION.md](./DATA_RETENTION.md).

---

## Version 1 definition of done

V1 is complete only when Muhammad can do **all** of the following:

**Access**
1. Sign in securely as the only authorised owner
2. Use Mad's Atlas on desktop and iPhone
3. Use the system without any permanent API key being exposed

**Voice**
4. Talk naturally through Gemini Live
5. Interrupt Atlas while it is speaking
6. Use text when voice is unavailable

**Intelligence**
7. Ask for current research and receive sourced information
8. Ask what requires attention today
9. See clear errors when an integration fails

**Calendar & mail**
10. Review today's calendar
11. Prepare for an upcoming meeting
12. Search and summarise Gmail
13. Prepare a Gmail draft for approval

**Capture**
14. Create tasks
15. Create reminders
16. Capture ideas
17. Convert an idea into a Claude Code brief

**Memory**
18. Save confirmed memories
19. Review suggested memories
20. Search personal memory
21. Edit or delete memories

**Control**
22. Review pending approvals
23. Approve consequential actions
24. Inspect action history

**Proactive**
25. Receive a daily briefing
26. Receive enabled browser reminders

**Data rights**
27. Export personal data
28. Delete all stored Atlas data

**Quality gate**
29. Pass all security, RLS, type, lint and build checks
30. Pass all critical end-to-end tests ([TESTING.md](./TESTING.md))

---

## Explicit non-goals for V1

Listing these prevents scope creep and sets expectations honestly:

- No always-on background microphone
- No WhatsApp or SMS integration
- No OpenAI usage
- No multi-user support, sharing or collaboration
- No mobile native app (responsive web only)
- No Google Drive, Contacts or Docs integration
- No calendar event **deletion** execution (proposal only)
- No autonomous device or OS control
- No automatic email sending under any circumstance
- No offline-first data sync (offline-*aware* UI only)

---

## Success criteria beyond the checklist

The system should be judged on:

- **Correct context** — does it retrieve the right memory, not the most memory?
- **Reliable memory** — does confirmed information persist and stay accurate?
- **Secure permissions** — can a wrong or manipulated model output cause harm?
- **Accurate tool use** — does it pick the right tool and pass valid arguments?
- **Clear approvals** — can Muhammad see exactly what will happen before it does?
- **Current research** — is every time-sensitive claim sourced?
- **Fast voice** — does conversation feel natural, with working interruption?
- **Traceable actions** — can every action be explained after the fact?
- **Privacy** — is anything stored that did not need to be?
- **Recoverability** — can any mistake be undone or at least understood?

Not: how impressive it sounds.
