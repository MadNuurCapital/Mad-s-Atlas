# Database Schema — Mad's Atlas

Postgres on Supabase. This document is the authoritative schema specification;
`supabase/migrations/` implements it in Phase 2 and must never diverge from it.

---

## Conventions

| Rule | Reason |
|---|---|
| UUID primary keys, `default gen_random_uuid()` | No enumerable IDs; safe to generate client-side for idempotency |
| All timestamps `timestamptz`, stored UTC | Singapore display conversion happens in the application layer only |
| Every personal table has `user_id uuid not null references auth.users(id) on delete cascade` | RLS anchor and complete-deletion path in one column |
| RLS enabled on every table in `public` | No exceptions, even for a single-user app |
| Status columns are `text` with a `CHECK` constraint | Readable in `psql`, migratable without the pain of altering a Postgres enum |
| `created_at` / `updated_at` on mutable tables, `updated_at` maintained by trigger | Never trust the application to set it |
| Soft delete (`deleted_at`) where recovery matters | Memories, tasks and ideas are recoverable; logs are not deleted, they expire |
| Every sensitive column carries a `COMMENT ON COLUMN` | The warning lives next to the column, not only in this file |

### Extensions required

Extensions live in a dedicated `extensions` schema, never in `public`:

```sql
create schema if not exists extensions;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector"   with schema extensions;  -- semantic memory
create extension if not exists "citext"   with schema extensions;  -- case-insensitive email
create extension if not exists "pg_cron";   -- scheduled jobs
create extension if not exists "pg_net";    -- cron → Edge Function invocation
```

> **Why the separate schema — this one bites.** Every security-definer function
> sets `search_path = ''` so it cannot be hijacked by a shadowing object. That
> also means operators and types must be schema-qualified, and a qualification
> needs a stable schema to point at. Install pgvector into `public`, write
> `embedding <=> query`, and the function **creates without complaint and then
> fails at call time** with `operator does not exist`. The same applies to
> `::citext` casts.
>
> Pinning the schema lets every reference be written explicitly:
> `extensions.vector(1536)`, `OPERATOR(extensions.<=>)`,
> `extensions.vector_cosine_ops`, `::extensions.citext`.
>
> `gen_random_uuid()` is in `pg_catalog` from PostgreSQL 13 onward, so column
> defaults resolve regardless of where `pgcrypto` landed.

### Table-level grants

RLS decides *which rows*; a `GRANT` decides whether the role may touch the
table at all. Supabase grants these to `authenticated` by default, so omitting
them appears to work there and fails on any other PostgreSQL — and inheriting
access control from a platform default is not worth depending on. Migration
`…_row_level_security.sql` therefore issues them explicitly, mirroring the
policy matrix below.

### Schemas

| Schema | Exposure | Contents |
|---|---|---|
| `public` | Data API, RLS-protected | All application tables |
| `private` | **Not exposed via the Data API** | `allowed_users`, `job_runs` |

`private` is excluded from the exposed schemas list in the Supabase dashboard
(Project Settings → Data API → Exposed schemas). Nothing in it is reachable
from a client, at any privilege level.

---

## Entity relationships

```
auth.users (Supabase-managed)
│
├─1:1─ profiles                     identity, timezone, briefing preferences
├─1:1─ user_settings                feature toggles, retention, thresholds
│
├─1:N─ connected_accounts           encrypted Google tokens  ⚠ service-role only
│
├─1:N─ memories ──1:N─ memory_versions
│         └─self─ superseded_by → memories.id
│
├─1:N─ tasks ◄──0:1── reminders.related_task_id
├─1:N─ reminders
├─1:N─ ideas ──1:N─ idea_steps ──0:1─► tasks / reminders / Google event ID
│                └─1:N─ idea_notes
│
├─1:N─ approvals ◄──0:1── action_logs.approval_id
├─1:N─ action_logs
├─1:N─ tool_runs ──0:1─► conversations.id
│
├─1:N─ conversations ──1:N─ conversation_messages
│
├─1:N─ research_reports ──1:N─ research_sources
├─1:N─ daily_briefings              UNIQUE (user_id, briefing_date, timezone)
├─1:N─ learning_items ──self─ superseded_by
├─1:N─ learning_feedback
├─1:N─ atlas_adaptations
├─1:N─ system_metrics
├─1:N─ evolution_proposals
└─1:N─ notification_subscriptions

private.allowed_users               signup allowlist, checked by auth hook
private.job_runs                    cron execution ledger + overlap lock
```

---

## `private` schema

### `private.allowed_users`

The first of four layers preventing anyone but Muhammad from having an account.

| Column | Type | Notes |
|---|---|---|
| `email` | `text` primary key | Stored lower-cased and trimmed |
| `enabled` | `boolean not null default true` | Revoke without deleting the row |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | trigger-maintained |

- RLS enabled with **no policies at all** — unreachable except by the secret key
  and by `security definer` functions.
- Seeded once by `scripts/seed-owner.ts` from `ATLAS_OWNER_EMAIL`. The script is
  idempotent (`insert … on conflict (email) do update set enabled = true`).

### `private.job_runs`

Makes scheduled work idempotent and non-overlapping.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `job_name` | `text not null` | e.g. `daily_briefing` |
| `run_key` | `text not null` | Logical identity of the unit of work, e.g. `daily_briefing:2026-08-06:Asia/Singapore` |
| `status` | `text not null` | `running`, `succeeded`, `failed`, `skipped` |
| `started_at` | `timestamptz not null default now()` | |
| `completed_at` | `timestamptz` | |
| `duration_ms` | `integer` | |
| `error_code` | `text` | |
| `details` | `jsonb not null default '{}'` | Never contains user content |

- `unique (job_name, run_key)` — the structural guarantee that a job cannot run
  the same unit of work twice, even if cron fires twice.
- Index on `(job_name, started_at desc)` for the admin status view.

---

## `public` schema

### Learning and evolution tables

Migration `20260808000013_learning_evolution.sql` adds five owner-scoped tables.
`learning_items` stores typed observations/inferences with bounded evidence,
confidence, lifecycle and contradiction history. `learning_feedback` is an
immutable review trail. `atlas_adaptations` holds reversible low-risk behavior
changes. `system_metrics` contains content-free aggregate health windows and is
client read-only. `evolution_proposals` stores inert, reviewable improvement
briefs; it cannot execute them. See [LEARNING_EVOLUTION.md](./LEARNING_EVOLUTION.md)
for thresholds, decay, costs and operational safeguards.

### Ideas & Planner

Migration `20260809000014_atlas_ideas_planner.sql` extends Ideas without adding
a parallel project-management system. `ideas.original_capture` is immutable.
An Idea stores Atlas Understanding, owner instructions, a draft plan version,
and its single next action. Status is one of `captured`, `planned`,
`in_progress`, `completed`, or `archived`.

`idea_steps` contains ordered, owner-scoped steps and optional links to the
existing Task, Reminder, and one deterministic Google Calendar event. Completed
steps survive re-planning. Notification timestamps independently guard the
upcoming, execute, and one plan-check alert. `idea_notes` stays local to its
Idea and is not copied into global Memory.

Composite `(id, user_id)` foreign keys prevent a child from linking to another
owner's Idea, Task, Reminder, or step even if a UUID were somehow known. Both
tables have full owner-only RLS. Stale cleanup is a query over
`last_touched_at`; no scheduled function permanently deletes Ideas.

### `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null unique` → `auth.users(id)` | `unique` enforces one profile per user |
| `email` | `citext not null` | Case-insensitive comparison throughout |
| `display_name` | `text` | |
| `preferred_name` | `text` | What Atlas calls him in conversation |
| `timezone` | `text not null default 'Asia/Singapore'` | IANA name |
| `locale` | `text not null default 'en-SG'` | |
| `default_voice` | `text` | Gemini Live voice identifier |
| `briefing_time` | `time not null default '09:00'` | Local to `timezone` |
| `briefing_enabled` | `boolean not null default true` | |
| `created_at` / `updated_at` | `timestamptz` | |

> `citext` requires `create extension if not exists citext;`. If it is
> unavailable, use `text` with a `lower(email)` unique index instead — the
> migration notes both.

### `connected_accounts` ⚠ highest-sensitivity table

Stores Google OAuth tokens encrypted with AES-256-GCM.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` → `auth.users(id)` | |
| `provider` | `text not null` | `'google'` |
| `provider_account_id` | `text not null` | Google `sub` claim |
| `email` | `citext not null` | The connected Google account |
| `granted_scopes` | `text[] not null default '{}'` | What consent actually returned — may be narrower than requested |
| `encrypted_access_token` | `bytea` | ⚠ ciphertext |
| `encrypted_refresh_token` | `bytea` | ⚠ ciphertext — **never overwrite with null** |
| `token_initialisation_vector` | `bytea` | ⚠ AES-GCM IV, unique per encryption |
| `token_authentication_tag` | `bytea` | ⚠ AES-GCM auth tag |
| `access_token_expires_at` | `timestamptz` | |
| `connection_status` | `text not null default 'connected'` | `connected`, `needs_reconnection`, `revoked`, `error` |
| `last_refreshed_at` | `timestamptz` | |
| `last_error` | `text` | Redacted message only, never a token |
| `created_at` / `updated_at` | `timestamptz` | |

Constraints and protections:

- `unique (user_id, provider, provider_account_id)`
- `check (connection_status in ('connected','needs_reconnection','revoked','error'))`
- **A trigger rejects any UPDATE that would set `encrypted_refresh_token` to
  NULL while a non-null value exists.** Google frequently omits the refresh
  token on re-consent; losing it silently would break every scheduled job. This
  is enforced in the database, not only in application code, and has a dedicated
  test.
- `COMMENT ON COLUMN` on all five token columns: *"Encrypted. Decryptable only
  in trusted server environments. Never expose to any client."*

RLS: the owner may `select` their own row, but **the token columns are excluded
from client access** by granting `select` only on the safe view below. Inserts
and updates to token columns occur through the secret key.

```sql
create view public.connected_account_status
with (security_invoker = true) as
select id, user_id, provider, email, granted_scopes,
       connection_status, access_token_expires_at,
       last_refreshed_at, created_at, updated_at
from public.connected_accounts;
```

`security_invoker = true` is essential — without it the view would run as its
owner and bypass RLS.

### `memories`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `title` | `text not null` | |
| `content` | `text not null` | |
| `category` | `text not null` | see below |
| `structured_data` | `jsonb not null default '{}'` | Typed detail per category |
| `status` | `text not null default 'suggested'` | see below |
| `confidence` | `numeric(3,2) not null default 0.50` | `check (confidence >= 0 and confidence <= 1)` |
| `sensitivity` | `text not null default 'normal'` | see below |
| `source_type` | `text not null` | `voice`, `text`, `email`, `calendar`, `research`, `manual`, `system` |
| `source_reference` | `text` | Conversation ID, Gmail thread ID, etc. |
| `confirmed_at` | `timestamptz` | First confirmation |
| `last_confirmed_at` | `timestamptz` | Most recent re-confirmation |
| `expires_at` | `timestamptz` | For temporary context |
| `superseded_by` | `uuid` → `memories(id)` | `on delete set null` |
| `embedding` | `vector(1536)` | Nullable — generated asynchronously |
| `search_vector` | `tsvector` generated | `to_tsvector('english', title ‖ ' ' ‖ content)`, stored |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

**Categories:** `profile`, `preference`, `goal`, `routine`, `important_person`,
`project`, `commitment`, `decision`, `idea_reference`, `temporary_context`

**Statuses:** `suggested`, `confirmed`, `superseded`, `expired`, `deleted`

**Sensitivity:** `normal`, `personal`, `sensitive`, `highly_sensitive`

All three are `CHECK`-constrained.

Indexes:

```sql
create index on memories using gin (search_vector);
create index on memories using hnsw (embedding vector_cosine_ops)
  where deleted_at is null and status = 'confirmed';
create index on memories (user_id, status, category) where deleted_at is null;
create index on memories (user_id, expires_at)
  where expires_at is not null and deleted_at is null;
create index on memories (user_id, embedding)          -- backfill scan
  where embedding is null and deleted_at is null;
```

> **Why `vector(1536)` and not 3072.** `gemini-embedding-001` returns 3072
> dimensions by default, but pgvector cannot build an HNSW or IVFFlat index on a
> `vector` wider than 2000 dimensions. Matryoshka truncation to 1536 keeps
> retrieval quality high and keeps the index. See
> [MEMORY_SYSTEM.md](./MEMORY_SYSTEM.md) § Changing embedding dimensions before
> altering this.

### `memory_versions`

Recoverable history. Written by trigger on every content-affecting update.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `memory_id` | `uuid not null` → `memories(id) on delete cascade` | |
| `user_id` | `uuid not null` | Denormalised so RLS needs no join |
| `previous_content` | `text not null` | |
| `previous_structured_data` | `jsonb not null default '{}'` | |
| `change_reason` | `text` | e.g. `user_edit`, `superseded`, `confidence_update` |
| `changed_by` | `text not null` | `user` or `atlas` |
| `created_at` | `timestamptz not null default now()` | |

Index: `(memory_id, created_at desc)`.

### `tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `title` | `text not null` | |
| `description` | `text` | |
| `status` | `text not null default 'inbox'` | `inbox`, `planned`, `in_progress`, `waiting`, `completed`, `cancelled` |
| `priority` | `text not null default 'normal'` | `low`, `normal`, `high`, `critical` |
| `due_at` / `start_at` / `completed_at` | `timestamptz` | |
| `source` | `text not null default 'manual'` | `manual`, `voice`, `email`, `briefing`, `idea` |
| `related_project` | `text` | Free text — a personal label, not a foreign key to any external system |
| `recurrence_rule` | `text` | RFC 5545 RRULE |
| `google_calendar_event_id` | `text` | Set only when mirrored, with approval |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | |

Indexes:

```sql
create index on tasks (user_id, status, due_at) where deleted_at is null;
create index on tasks (user_id, due_at)
  where deleted_at is null and status not in ('completed','cancelled');
create index on tasks (user_id, priority, due_at)
  where deleted_at is null and status not in ('completed','cancelled');
```

`check (completed_at is null or status = 'completed')` keeps the two consistent.

### `reminders`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `title` | `text not null` | |
| `description` | `text` | |
| `remind_at` | `timestamptz not null` | UTC |
| `recurrence_rule` | `text` | RFC 5545 RRULE |
| `timezone` | `text not null default 'Asia/Singapore'` | Needed to expand recurrence correctly |
| `delivery_channel` | `text not null default 'in_app'` | `push` is legacy; active values use `in_app` or `calendar` |
| `status` | `text not null default 'scheduled'` | `scheduled`, `triggered`, `acknowledged`, `disabled`, `completed` |
| `related_task_id` | `uuid` → `tasks(id) on delete set null` | |
| `google_calendar_event_id` | `text` | Only when mirrored, with approval |
| `last_triggered_at` | `timestamptz` | |
| `next_trigger_at` | `timestamptz` | Computed for recurring reminders |
| `created_at` / `updated_at` | `timestamptz` | |

Index: `create index on reminders (next_trigger_at) where status = 'scheduled';`
— the cron job's only lookup, deliberately narrow.

### `ideas`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `title` | `text not null` | |
| `original_capture` | `text not null` | Preserved verbatim — never rewritten |
| `summary` | `text` | |
| `category` | `text` | |
| `status` | `text not null default 'captured'` | `captured`, `exploring`, `planned`, `building`, `completed`, `parked`, `archived` |
| `next_action` | `text` | |
| `structured_plan` | `jsonb not null default '{}'` | Includes the generated Claude Code brief |
| `created_at` / `updated_at` / `archived_at` | `timestamptz` | |

### `approvals`

The safety-critical table. Every constraint here exists to make double
execution impossible rather than unlikely.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `action_type` | `text not null` | The tool name, e.g. `gmail.execute_create_draft` |
| `title` | `text not null` | Human-readable summary |
| `reason` | `text not null` | Why Atlas is proposing this |
| `proposed_payload` | `jsonb not null` | **Exactly** what will be executed |
| `payload_hash` | `text not null` | SHA-256 of canonicalised `proposed_payload` |
| `affected_data` | `jsonb not null default '{}'` | Records and external systems touched |
| `status` | `text not null default 'pending'` | `pending`, `approved`, `rejected`, `expired`, `executed`, `failed` |
| `idempotency_key` | `text not null` | |
| `requested_at` | `timestamptz not null default now()` | |
| `expires_at` | `timestamptz not null` | `requested_at + user_settings.approval_expiry_minutes` |
| `approved_at` / `rejected_at` / `executed_at` | `timestamptz` | |
| `execution_result` | `jsonb` | Redacted result summary |
| `supersedes_approval_id` | `uuid` → `approvals(id)` | Set when an edit creates a new version |
| `created_at` / `updated_at` | `timestamptz` | |

Constraints:

- `unique (idempotency_key)` — global, not per-user
- `check (expires_at > requested_at)`
- `check (status in (...))`

Rules enforced by `claim_approval()` (below), not by convention:

1. An approval may execute **at most once**.
2. An expired approval can never execute, even if approved before expiry.
3. The payload executed is byte-identical to the payload approved — verified
   against `payload_hash`.
4. Editing produces a **new** approval row with `supersedes_approval_id` set;
   the original moves to `rejected`. The old approval can never execute the new
   payload.

Index: `create index on approvals (user_id, status, expires_at);`

### `action_logs`

The audit trail. What Atlas did, never the sensitive content it touched.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `session_id` | `uuid` | Groups a voice or text session |
| `tool_name` | `text not null` | |
| `operation_type` | `text not null` | `read`, `analyse`, `propose`, `execute`, `refuse` |
| `action_summary` | `text not null` | Human-readable, redacted |
| `status` | `text not null` | `success`, `failure`, `refused`, `timeout` |
| `approval_id` | `uuid` → `approvals(id) on delete set null` | |
| `duration_ms` | `integer` | |
| `error_code` | `text` | Internal code, not a stack trace |
| `metadata` | `jsonb not null default '{}'` | Counts and identifiers only |
| `created_at` | `timestamptz not null default now()` | |

**Never written here:** API keys, OAuth tokens, passwords, full email bodies,
raw audio, memory content, or any other private content. A `COMMENT ON TABLE`
states this. A redaction helper is applied at every call site, and a unit test
asserts that known secret patterns never appear.

Indexes: `(user_id, created_at desc)`, `(user_id, tool_name, created_at desc)`,
`(user_id, status, created_at desc)`.

### `conversations`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `title` | `text` | |
| `channel` | `text not null` | `voice`, `text`, `system`, `scheduled` |
| `started_at` | `timestamptz not null default now()` | |
| `ended_at` | `timestamptz` | |
| `summary` | `text` | Retained; raw messages are not |
| `retention_until` | `timestamptz` | From `user_settings.conversation_retention_days` |
| `created_at` / `updated_at` | `timestamptz` | |

### `conversation_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `conversation_id` | `uuid not null` → `conversations(id) on delete cascade` | |
| `user_id` | `uuid not null` | Denormalised for RLS |
| `role` | `text not null` | `user`, `assistant`, `system`, `tool` |
| `content` | `text not null` | |
| `tool_call_metadata` | `jsonb not null default '{}'` | |
| `created_at` | `timestamptz not null default now()` | |
| `retention_until` | `timestamptz not null` | Cleanup job deletes past this |

Default behaviour, enforced by the retention job:

- Raw voice audio is never stored anywhere.
- Voice transcripts are session-only unless explicitly saved.
- Text messages are retained temporarily for continuity.
- Anything permanent belongs in `memories`, not here.

Index: `(retention_until)` — the cleanup job's only scan.

### `research_reports`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `query` | `text not null` | |
| `summary` | `text not null` | |
| `why_it_matters` | `text` | |
| `structured_result` | `jsonb not null default '{}'` | Key findings, implications, uncertainty, conflicts |
| `searched_at` | `timestamptz not null` | When the search actually ran |
| `created_at` | `timestamptz not null default now()` | |

### `research_sources`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `research_report_id` | `uuid not null` → `research_reports(id) on delete cascade` | |
| `user_id` | `uuid not null` | |
| `title` | `text not null` | |
| `publisher` | `text` | |
| `source_url` | `text not null` | Validated `http`/`https` only, no internal addresses |
| `publication_date` | `date` | Null when genuinely unknown — never guessed |
| `accessed_at` | `timestamptz not null` | |
| `relevance_score` | `numeric(3,2)` | `check` between 0 and 1 |
| `created_at` | `timestamptz not null default now()` | |

A report with no sources cannot be presented as verified. Citations are never
fabricated — if grounding returns nothing, the report says so.

### `daily_briefings`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `briefing_date` | `date not null` | Local date in `timezone` |
| `timezone` | `text not null` | |
| `calendar_summary` | `jsonb not null default '{}'` | |
| `email_summary` | `jsonb not null default '{}'` | |
| `task_summary` | `jsonb not null default '{}'` | |
| `market_summary` | `jsonb not null default '{}'` | |
| `technology_summary` | `jsonb not null default '{}'` | |
| `recommended_priority` | `text` | The single most important action |
| `full_briefing` | `text` | Rendered narrative |
| `generated_at` / `delivered_at` | `timestamptz` | |
| `status` | `text not null default 'generating'` | `generating`, `ready`, `delivered`, `failed` |
| `created_at` / `updated_at` | `timestamptz` | |

**`unique (user_id, briefing_date, timezone)`** — the final backstop against
duplicate briefings, independent of the job lock.

### `notification_subscriptions` (legacy, disabled)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `endpoint` | `text not null` | Push service URL |
| `p256dh` | `text not null` | ⚠ Subscription public key |
| `auth_secret` | `text not null` | ⚠ Subscription auth secret |
| `user_agent` | `text` | To let the user identify a device |
| `enabled` | `boolean not null default true` | |
| `created_at` / `updated_at` | `timestamptz` | |

`unique (user_id, endpoint)`. `p256dh` and `auth_secret` are treated as
credentials: never returned to any client, never logged, commented as
sensitive. Migration 0015 disables every row; Atlas no longer sends push messages.

### `tool_runs`

Mechanics of execution, separate from the audit trail.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null` | |
| `conversation_id` | `uuid` → `conversations(id) on delete set null` | |
| `tool_name` | `text not null` | |
| `input_summary` | `text` | Redacted |
| `output_summary` | `text` | Redacted |
| `status` | `text not null` | `running`, `succeeded`, `failed`, `cancelled`, `timeout` |
| `started_at` | `timestamptz not null default now()` | |
| `completed_at` | `timestamptz` | |
| `error_code` | `text` | |
| `retry_count` | `integer not null default 0` | |
| `created_at` | `timestamptz not null default now()` | |

### `user_settings`

| Column | Type | Default |
|---|---|---|
| `id` | `uuid` pk | |
| `user_id` | `uuid not null unique` | |
| `memory_enabled` | `boolean not null` | `true` |
| `proactive_briefings_enabled` | `boolean not null` | `true` |
| `email_summary_enabled` | `boolean not null` | `true` |
| `calendar_preparation_enabled` | `boolean not null` | `true` |
| `notification_enabled` | `boolean not null` | legacy compatibility field, kept `false` |
| `conversation_retention_days` | `integer not null` | `30`, `check between 1 and 365` |
| `research_detail_level` | `text not null` | `standard` — `brief`, `standard`, `detailed` |
| `approval_expiry_minutes` | `integer not null` | `60`, `check between 5 and 1440` |
| `meeting_prep_lead_minutes` | `integer not null` | `30`, `check between 5 and 240` |
| `created_at` / `updated_at` | `timestamptz` | |

> `meeting_prep_lead_minutes` is not in the original field list but is required
> by the "configurable period before an event, default 30 minutes" requirement.
> It belongs here rather than as a hard-coded constant.

---

## Row Level Security

Enabled on **every** table in `public`. The pattern is identical throughout:

```sql
alter table public.<table> enable row level security;

create policy "<table>_select_own" on public.<table>
  for select to authenticated using (auth.uid() = user_id);

create policy "<table>_insert_own" on public.<table>
  for insert to authenticated with check (auth.uid() = user_id);

create policy "<table>_update_own" on public.<table>
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "<table>_delete_own" on public.<table>
  for delete to authenticated using (auth.uid() = user_id);
```

No policy grants `anon`. No policy uses `true`. No policy grants access to
`authenticated` broadly.

### Policy matrix

| Table | select | insert | update | delete | Notes |
|---|---|---|---|---|---|
| `profiles` | own | own | own | ✗ | Deleted only by full-account deletion |
| `user_settings` | own | own | own | ✗ | |
| `connected_accounts` | **none** | ✗ | ✗ | own | Client reads the status view; writes are secret-key only |
| `memories` | own | own | own | own | Soft delete preferred |
| `memory_versions` | own | ✗ | ✗ | ✗ | Written by trigger only |
| `tasks` | own | own | own | own | |
| `reminders` | own | own | own | own | |
| `ideas` | own | own | own | own | |
| `approvals` | own | ✗ | own¹ | ✗ | ¹ status transitions only, via RPC |
| `action_logs` | own | ✗ | ✗ | ✗ | Append-only, written server-side |
| `conversations` | own | own | own | own | |
| `conversation_messages` | own | own | ✗ | own | Immutable once written |
| `research_reports` | own | ✗ | ✗ | own | |
| `research_sources` | own | ✗ | ✗ | own | Cascades with the report |
| `daily_briefings` | own | ✗ | ✗ | own | Generated by Edge Function |
| `notification_subscriptions` | own² | own | own | own | ² key columns excluded from the client-facing view |
| `tool_runs` | own | ✗ | ✗ | ✗ | Append-only |

Tables with `✗` for insert are written using the secret key from server code or
Edge Functions, which bypasses RLS by design. That is exactly why the secret key
must never reach the browser.

**Verification.** Phase 2 ships an integration test that creates two users
directly against `SUPABASE_DB_URL`, writes a row as each, and asserts that
neither can read, update or delete the other's row in any table. The test fails
the build if a new table is added without policies.

---

## Triggers

| Trigger | On | Does |
|---|---|---|
| `set_updated_at` | every mutable table | `new.updated_at = now()` |
| `memories_version_on_update` | `memories` | Inserts the prior content into `memory_versions` when `content` or `structured_data` changes |
| `connected_accounts_protect_refresh_token` | `connected_accounts` | Raises an exception if an UPDATE would null a non-null `encrypted_refresh_token` |
| `handle_new_user` | `auth.users` insert | Creates the matching `profiles` and `user_settings` rows |
| `memories_expire_check` | `memories` | Sets `status = 'expired'` when `expires_at` passes (also swept by cron) |

---

## Database functions

All are `security definer`, and every one of them:

- sets `search_path = ''` and fully qualifies identifiers
- validates `auth.uid()` and returns nothing for a mismatched user
- returns only the columns needed
- contains **no dynamic SQL**

| Function | Purpose |
|---|---|
| `public.is_owner() returns boolean` | True only if the caller's session email matches the allowlist and is enabled. Used inside other functions, not as a substitute for RLS. |
| `public.claim_approval(p_approval_id uuid, p_idempotency_key text) returns approvals` | Atomically transitions `approved → executed`. `UPDATE … WHERE id = $1 AND status = 'approved' AND idempotency_key = $2 AND expires_at > now() RETURNING *`. Returns zero rows if already claimed, expired, or key-mismatched — so a duplicate click cannot execute twice. |
| `public.search_memories_semantic(p_embedding vector(1536), p_limit int, p_min_similarity numeric)` | Cosine similarity over confirmed, non-deleted memories. |
| `public.search_memories_hybrid(p_query text, p_embedding vector(1536), p_categories text[], p_limit int)` | Weighted blend of full-text rank, vector similarity, recency and confidence. Scoring in [MEMORY_SYSTEM.md](./MEMORY_SYSTEM.md). |
| `public.get_today_agenda(p_timezone text)` | Today's tasks, reminders and events in the given timezone. |
| `public.get_overdue_tasks()` | Incomplete tasks with `due_at < now()`. |
| `public.get_due_reminders(p_horizon interval)` | Scheduled reminders due within the horizon. Used by cron. |
| `public.purge_expired_approvals()` | `pending → expired` past `expires_at`. |
| `public.purge_expired_conversations()` | Deletes messages and conversations past `retention_until`. |
| `public.purge_action_logs(p_retain_days int)` | Deletes audit rows older than the retention window. |
| `public.export_all_user_data() returns jsonb` | Complete export of the caller's own data. Excludes every token column by construction, not by filtering. |
| `public.delete_all_user_data()` | Deletes all Atlas data for the caller in one transaction. Ordered to respect foreign keys. Irreversible, and the UI says so. |

### The approval claim, in full

This is the heart of the safety model:

```sql
create or replace function public.claim_approval(
  p_approval_id uuid,
  p_idempotency_key text
) returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.approvals;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  update public.approvals
     set status = 'executed',
         executed_at = now(),
         updated_at = now()
   where id = p_approval_id
     and user_id = auth.uid()
     and status = 'approved'
     and idempotency_key = p_idempotency_key
     and expires_at > now()
  returning * into v_row;

  if not found then
    raise exception 'approval_not_claimable' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;
```

The single `UPDATE … RETURNING` is the atomic claim. A second concurrent call
finds `status` already `executed` and raises. The caller then verifies
`payload_hash` against the payload it is about to execute before making any
external call, and marks the approval `failed` if execution errors.

---

## Migrations

- One numbered file per change in `supabase/migrations/`, applied in order.
- Idempotent: `create table if not exists`, `create index if not exists`,
  `drop policy if exists` before `create policy`.
- Every file's header comment states its purpose and its rollback: the exact
  inverse statements, or an explicit note that the change is not reversible
  without data loss.
- Never edit an applied migration. Add a new one.
- Regenerate types after every schema change:

```bash
npm run db:types      # supabase gen types typescript --linked > src/types/database.ts
```

### Rollback guidance

| Change type | Rollback |
|---|---|
| New table | `drop table if exists … cascade` — safe, no data loss if unused |
| New column | `alter table … drop column` — **destroys data in that column** |
| New index | `drop index if exists` — always safe |
| New policy | `drop policy if exists` — **weakens security**; verify before deploying |
| Embedding dimension change | Not reversible in place. Requires a new column, a full re-embed, and a cutover. See [MEMORY_SYSTEM.md](./MEMORY_SYSTEM.md). |
