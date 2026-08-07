# Permissions — Mad's Atlas

Every action Atlas can take falls into exactly one of three levels. The level is
a property of the tool, declared in the registry, resolved server-side. The
model never supplies it.

---

## The three levels

### Level 1 — Automatic read or analysis

Runs immediately. No approval. Reading, searching, summarising, reasoning,
recommending. Nothing leaves the system and nothing changes state that Muhammad
would not expect.

### Level 2 — Prepare and approve

Creates an `approvals` record and stops. Muhammad sees exactly what will happen
and approves, rejects, or edits. Execution is a separate, atomic, once-only
step.

Anything with an external effect, a lasting effect, or a sensitivity concern
lands here.

### Level 3 — Disabled

Not implemented. No code path exists. A request for one of these is refused and
logged as `operation_type = 'refuse'`.

Level 3 is not a permission that could be granted later by flipping a flag —
the functionality is absent.

---

## Level 3 — the complete list

| Forbidden | Why |
|---|---|
| Send email | Irreversible, impersonates Muhammad, prime injection target |
| Make payments | Financial harm |
| Execute investments | Financial harm; also out of product scope |
| Purchase products | Financial harm |
| Publish public content | Reputational, irreversible |
| Delete Gmail messages | Irreversible data loss |
| Control the operating system | Far outside a web app's remit |
| Access passwords | No legitimate use here |
| Share private data externally | The whole point is that it stays private |
| Connect to Atlas DART / Academy / Investments | Hard product boundary |
| Execute financial transactions | Financial harm |

Calendar **event deletion execution** is also absent in V1. Atlas may propose a
deletion (`calendar.propose_delete`) so Muhammad can act, but there is no
`calendar.execute_delete`.

---

## Tool registry

Every tool, its level, and what it does. A tool absent from this table does not
exist; a tool present here has exactly the level shown.

### System

| Tool | Level | Description |
|---|---|---|
| `system.get_current_context` | 1 | Date, time, timezone, connection state, active session |
| `system.get_daily_brief` | 1 | Today's generated briefing |
| `system.get_primary_priority` | 1 | The single most important next action |
| `system.get_action_history` | 1 | Recent actions from the audit log |
| `system.get_connection_status` | 1 | Google and Gemini connection health |

### Research

| Tool | Level | Description |
|---|---|---|
| `research.search_current_web` | 1 | Grounded search with real sources |
| `research.get_saved_report` | 1 | Retrieve a stored report |
| `research.compare_sources` | 1 | Contrast findings, surface conflicts |
| `research.summarise_topic` | 1 | Synthesise across saved reports |

### Calendar

| Tool | Level | Description |
|---|---|---|
| `calendar.list_today` | 1 | Today's events |
| `calendar.list_upcoming` | 1 | Events ahead |
| `calendar.get_event` | 1 | One event's detail |
| `calendar.find_availability` | 1 | Free slots |
| `calendar.prepare_meeting` | 1 | Meeting brief from memory, mail and history |
| `calendar.execute_create` | 1 | Create an event immediately when Muhammad requests it |
| `calendar.propose_update` | 2 | Reserved; calendar updates are not currently implemented |
| `calendar.execute_update` | 2 | Execute an approved change |
| `calendar.propose_delete` | 2 | Propose only — **no execute counterpart in V1** |

### Gmail

| Tool | Level | Description |
|---|---|---|
| `gmail.search` | 1 | Search messages |
| `gmail.get_thread` | 1 | Retrieve a thread |
| `gmail.summarise_thread` | 1 | Summarise a thread |
| `gmail.find_action_required` | 1 | Classify what needs a response |
| `gmail.propose_draft` | 2 | Create an approval for a draft |
| `gmail.execute_create_draft` | 2 | Create the draft in Gmail after approval |

**Not implemented:** `gmail.send`, `gmail.delete`, `gmail.archive_bulk`.

### Tasks

| Tool | Level | Description |
|---|---|---|
| `tasks.list` | 1 | List with filters |
| `tasks.list_today` | 1 | Due today |
| `tasks.list_overdue` | 1 | Past due, incomplete |
| `tasks.create` | 1 | Create a task |
| `tasks.update` | 1 | Update fields |
| `tasks.complete` | 1 | Mark complete |
| `tasks.propose_delete` | 2 | Create an approval to delete |
| `tasks.execute_delete` | 2 | Execute an approved deletion |

> Task creation and update are Level 1 because they are internal, reversible and
> visible. Deletion is Level 2 because it destroys something Muhammad wrote.

### Reminders

| Tool | Level | Description |
|---|---|---|
| `reminders.list` | 1 | List reminders |
| `reminders.create` | 1 | Create a reminder |
| `reminders.update` | 1 | Update a reminder |
| `reminders.disable` | 1 | Stop a reminder firing |

> Mirroring a reminder to Google Calendar is an **external write** and is
> therefore Level 2, handled through `calendar.propose_create`.

### Memory

| Tool | Level | Description |
|---|---|---|
| `memory.search` | 1 | Hybrid search over confirmed memories |
| `memory.get` | 1 | Retrieve one memory |
| `memory.propose_save` | 1 or 2 | **See the rule below** |
| `memory.confirm_save` | 1 | Promote a suggestion Muhammad approved |
| `memory.update` | 1 or 2 | Level 2 if the memory is sensitive |
| `memory.supersede` | 1 | Replace with a newer version, keeping history |
| `memory.delete` | 1 | Soft delete (recoverable from versions) |
| `memory.export_all` | 2 | Bulk export of personal information |

**The memory sensitivity rule.** `memory.propose_save` is Level 1 when the
memory is `sensitivity = 'normal'` and clearly factual. It escalates to Level 2
when the content is personal, sensitive or highly sensitive; ambiguous; likely
to change; or important to future decisions. The classifier's *suggestion* is
advisory — the escalation itself is decided server-side, and when in doubt it
escalates.

A suggestion **never becomes confirmed memory automatically**, at any level.

### Ideas

| Tool | Level | Description |
|---|---|---|
| `ideas.capture` | 1 | Capture verbatim |
| `ideas.list` | 1 | List ideas |
| `ideas.get` | 1 | Retrieve one |
| `ideas.create_plan` | 1 | Generate a structured plan |
| `ideas.update_status` | 1 | Move through the pipeline |
| `ideas.archive` | 1 | Archive |
| `ideas.create_claude_code_brief` | 1 | Generate an implementation brief |

### Approvals

| Tool | Level | Description |
|---|---|---|
| `approvals.list` | 1 | List by status |
| `approvals.get` | 1 | Full detail including exact payload |
| `approvals.approve` | 1* | Records Muhammad's decision |
| `approvals.reject` | 1 | Records rejection |
| `approvals.edit` | 1* | Creates a **new** approval superseding the old |

\* These tools record a human decision; they do not perform the underlying
action. The action itself remains Level 2 and executes through
`claim_approval()`. Approving is not executing.

### Notifications

| Tool | Level | Description |
|---|---|---|
| `notifications.subscribe` | 1 | Register a push subscription (browser permission required first) |
| `notifications.unsubscribe` | 1 | Remove a subscription |
| `notifications.test` | 1 | Send a test push to Muhammad's own device |

---

## Where enforcement happens

Four independent points. Bypassing one achieves nothing.

**1 — Registry (`src/lib/atlas/tools/`)**
A tool not registered cannot be invoked, whatever the model emits. The level is
read from the registry, never from model output.

**2 — Permission engine (`src/lib/atlas/permissions/`)**
```
resolve(toolName) → level
  level 3 → refuse, log, return a clear explanation
  level 2 → create approval, return "awaiting approval"
  level 1 → check budget, then execute
```

**3 — Input validation**
Zod schema per tool. Invalid arguments are refused, never coerced into
something plausible.

**4 — Database**
RLS on every table. `claim_approval()` enforces status, ownership, expiry and
idempotency atomically. Even a fully compromised application layer cannot
execute an approval twice or read another user's data.

---

## The approval record

Every Level 2 action produces a record showing:

- **Action** — the tool name in plain language
- **Reason** — why Atlas proposed it
- **Exact proposed payload** — the literal JSON that will be executed
- **Human-readable summary** — what it means
- **Records affected** — which rows
- **External system affected** — Gmail, Calendar, or none
- **Requested time** and **Expiry time**
- **Approve** / **Reject** / **Edit before approval**

### Execution sequence

```
1  Verify the session
2  Verify owner status
3  Verify approval status = 'approved'
4  Verify not expired
5  Verify payload_hash matches the payload about to run
6  claim_approval(id, idempotency_key)      ← atomic; fails if already claimed
7  Execute the external call, with timeout and abort
8  Store execution_result (redacted)
9  Write action_logs
10 On failure: status = 'failed', with the error code — never silently retried
```

Editing an approval **never** mutates the original. It creates a new approval
with `supersedes_approval_id` set and moves the original to `rejected`. The old
approval can never execute the new payload — the hash would not match even if it
somehow reached execution.

---

## Budget guardrails

Checked alongside the permission level, before execution:

| Limit | Applies to |
|---|---|
| Daily Gemini requests | All model calls |
| Per-minute voice minutes | Live sessions |
| Maximum session length | Live sessions |
| Maximum research calls per user request | `research.*` |
| Maximum tool-loop depth | The orchestrator |
| Maximum retries | Every tool |

Exceeding a limit produces a plain refusal — *"I've hit today's research limit,
so I can't run another search until tomorrow"* — never a silent failure and
never a degraded answer presented as a full one.

---

## Adding a tool

1. Add the row to the table above **first** — the doc is the specification.
2. Implement `AtlasTool` in `src/lib/atlas/tools/<domain>/<name>.ts`.
3. Declare `permissionLevel` explicitly. There is no default.
4. Write the Zod input schema; validate everything, trust nothing.
5. Register it. An unregistered tool is unreachable.
6. Add a unit test for the permission decision, including the refusal path.
7. If Level 2, add an approval-flow integration test covering double execution
   and expiry.

If a tool would be Level 3, do not implement it. Say so and stop.
