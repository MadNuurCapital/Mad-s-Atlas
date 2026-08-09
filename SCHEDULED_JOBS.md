# Scheduled Jobs — Mad's Atlas

Supabase Cron (`pg_cron`) invokes Supabase Edge Functions. All schedules are
UTC.

---

## Singapore time — the one thing to get right

**Singapore is a fixed UTC+08:00 and has no daylight saving time.** It has not
observed DST since 1935. Never apply DST logic to `Asia/Singapore`.

| Singapore | UTC |
|---|---|
| 00:00 | 16:00 previous day |
| **09:00** | **01:00** ← the daily briefing |
| 12:00 | 04:00 |
| 18:00 | 10:00 |
| 23:00 | 15:00 |

All timestamps are **stored** in UTC and **displayed** in `Asia/Singapore`.
Cron expressions are written in UTC.

---

## Job catalogue

| Job | Cron (UTC) | Singapore | Function | Purpose |
|---|---|---|---|---|
| `daily_briefing` | `0 1 * * *` | 09:00 daily | `daily-briefing` | Generate the morning briefing |
| `check_reminders` | `*/5 * * * *` | every 5 min | `check-reminders` | Fire reminders and bounded Idea plan alerts |
| `meeting_preparation` | `*/10 * * * *` | every 10 min | `meeting-preparation` | Prepare briefs before meetings |
| `generate_embeddings` | `*/15 * * * *` | every 15 min | `generate-embeddings` | Embed new memories, retry failures |
| `expire_approvals` | `*/10 * * * *` | every 10 min | `maintenance` | `pending → expired` past expiry |
| `purge_conversations` | `30 17 * * *` | 01:30 daily | `maintenance` | Delete conversations past retention |
| `expire_memories` | `0 18 * * *` | 02:00 daily | `maintenance` | Mark memories past `expires_at` |
| `purge_action_logs` | `0 19 * * 0` | 03:00 **Monday** | `maintenance` | Trim the audit log |
| `learning_reflection` | `30 18 * * *` | 02:30 daily | `learning-reflection` | Aggregate health and update evidence/confidence |
| `learning_consolidation` | `0 20 * * 0` | 04:00 **Monday** | `learning-reflection` (`weekly: true`) | Consolidate, decay and propose improvements |

Housekeeping runs in the small hours Singapore time, when Muhammad is asleep and
nothing is competing for it.

> **Watch the day boundary.** Any UTC time from 16:00 onward is the *next* day
> in Singapore. `0 19 * * 0` is Sunday 19:00 UTC, which is **Monday** 03:00 SGT —
> the cron day-of-week field is UTC, not local. Getting this backwards is the
> easiest mistake to make here.

---

## Contract every job must satisfy

1. **Clear name** — matches `private.job_runs.job_name` exactly.
2. **UTC schedule** — no local-time cron expressions.
3. **Documented** — it appears in the table above, or it does not exist.
4. **Idempotent** — running twice produces one result.
5. **Records outcome** — a `private.job_runs` row, always, including failures.
6. **No overlap** — the run is claimed before any work begins.
7. **Bounded time** — a hard timeout, well under the platform limit.
8. **Bounded retries** — never an infinite retry loop.

### The claim pattern

Every job starts the same way. `unique (job_name, run_key)` does the real work:

```sql
insert into private.job_runs (job_name, run_key, status)
values ('daily_briefing', 'daily_briefing:2026-08-06:Asia/Singapore', 'running')
on conflict (job_name, run_key) do nothing
returning id;
```

No row returned means another invocation already owns this unit of work. **Exit
immediately.** This is what makes duplicate cron firings harmless rather than
merely unlikely.

---

## Creating the jobs

Run once in the Supabase SQL Editor, after deploying the functions. Replace
`<project-ref>` and use your **secret key** for the authorisation header.

```sql
select cron.schedule(
  'daily_briefing',
  '0 1 * * *',
  $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.settings.service_key')
               ),
    body    := jsonb_build_object('scheduled', true),
    timeout_milliseconds := 60000
  );
  $$
);
```

Repeat for each job in the catalogue, substituting name, schedule and function.

> **Storing the key.** Do not paste the secret key literally into the cron
> command — it becomes readable in `cron.job`. Store it once in Supabase Vault
> and read it via `current_setting`, or use the dashboard's cron UI, which
> handles this for you.

### Managing jobs

```sql
-- list
select jobid, jobname, schedule, active from cron.job order by jobname;

-- recent runs
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 20;

-- pause / resume / remove
select cron.alter_job((select jobid from cron.job where jobname = 'daily_briefing'), active := false);
select cron.alter_job((select jobid from cron.job where jobname = 'daily_briefing'), active := true);
select cron.unschedule('daily_briefing');
```

---

## The jobs in detail

### `daily_briefing`

Runs at 09:00 Singapore. Produces the briefing shown on `/today`.

```
1  run_key = 'daily_briefing:<local date>:<timezone>'
2  claim it — exit if already claimed
3  check profiles.briefing_enabled and
         user_settings.proactive_briefings_enabled — exit quietly if off
4  gather:
     • today's calendar events            (Google, skip if disconnected)
     • upcoming reminders                 (Supabase)
     • overdue and high-priority tasks    (Supabase)
     • important unread email             (Google, skip if disconnected)
     • pending approvals                  (Supabase)
     • five intelligence stories          (Gemini + Google Search grounding)
5  synthesise a recommended primary action
6  upsert into daily_briefings
     on conflict (user_id, briefing_date, timezone) do nothing
7  send a web push if notifications are enabled
8  mark the job run succeeded
```

**Intelligence story priorities:** global markets and investing, Singapore
business and economy, AI, technology, web applications, and useful things
Muhammad could build using AI. Balanced between Singapore and global. Each story
carries what happened, why it matters, the practical implication or opportunity,
and its sources.

**Two independent duplicate guards:** the job claim, and
`unique (user_id, briefing_date, timezone)` on the table. Either alone would be
sufficient; both together mean a duplicate briefing is not a realistic failure
mode.

**Degraded operation.** If Google is disconnected, the briefing is still
generated with the sections it can fill, and it says plainly that calendar and
email were unavailable. It never presents an incomplete briefing as complete.

### `check_reminders`

Every five minutes. The tightest schedule in the system, and deliberately the
cheapest job.

```
1  select from reminders where status = 'scheduled'
     and next_trigger_at <= now() + interval '5 minutes'
2  for each:
     • run_key = 'reminder:<id>:<next_trigger_at>'   ← includes the time,
       so a recurring reminder can fire again next occurrence
     • claim, deliver push if enabled, set last_triggered_at
     • recurring → compute the next occurrence from recurrence_rule
                   in the reminder's own timezone
     • one-off   → status = 'triggered'
```

Recurrence is expanded in the reminder's stored timezone, not the server's.

Approved Idea steps use the same job and subscriptions, but a separate
idempotency key per step, scheduled instant and alert kind:

1. `ATLAS // UPCOMING` about 15 minutes before the session.
2. `ATLAS // EXECUTE` when the session starts.
3. At most one `ATLAS // PLAN CHECK` 60 minutes after the scheduled end if the
   step is still unfinished. This marks the existing linked task “Needs
   attention”; it never creates a duplicate task.

Notification actions are `Done`, `Open plan`, and, for a missed session,
`Reschedule`. They deep-link to the exact Idea. The service worker caches no
private application data.

The function requires these Supabase Edge Function secrets:
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.

### `meeting_preparation`

Every ten minutes. Prepares Muhammad before a meeting starts.

```
1  exit if user_settings.calendar_preparation_enabled is false
2  find events starting within meeting_prep_lead_minutes (default 30)
3  skip events marked private where access is insufficient
4  run_key = 'meeting_prep:<event id>:<event start>'   ← never prepared twice
5  gather: relevant confirmed memories, permitted related Gmail threads,
          unresolved actions involving the attendees
6  generate a concise preparation brief
7  save it; notify if enabled
```

**Hard constraints:** never contacts attendees. Never modifies the calendar.
Never generates the same brief twice.

### `generate_embeddings`

Every fifteen minutes. Keeps semantic search current without ever blocking a
save.

```
1  select memories where embedding is null and deleted_at is null, limit 50
2  batch-embed via GEMINI_EMBEDDING_MODEL at 1536 dimensions
3  update rows
4  on failure: increment a retry counter with backoff; after N attempts
   flag the row for review rather than retrying forever
```

A memory without an embedding is still fully searchable by full-text and
structured filters. Embedding failure never loses data.

### `maintenance`

One function, several tasks, dispatched by a `task` parameter:

| Task | Does |
|---|---|
| `expire_approvals` | `pending → expired` past `expires_at` |
| `purge_conversations` | Deletes messages and conversations past `retention_until` |
| `expire_memories` | Marks memories past `expires_at` as `expired` |
| `purge_action_logs` | Deletes audit rows older than the retention window |

Each is a single security-definer function call, so the work happens in the
database rather than being pulled out and pushed back.

### `learning-reflection`

Runs deterministically and makes no Gemini or embedding request. The daily run
aggregates redacted action-log outcomes into latency and failure-rate windows,
reinforces pattern lifecycle state and gradually decays stale, unconfirmed
inferences. The weekly run uses a seven-day window and performs the same bounded
consolidation. Confirmed or pinned items never decay.

Only a confirmed communication preference can become an automatic adaptation,
and only when **Automatic low-risk adaptations** is enabled. That adaptation is
an inert prompt instruction, is visible on `/evolution`, and is reversible.
Degraded metrics can create an exportable proposal, but the job cannot execute
code, run a shell command, push, merge, change permissions or deploy.

This function uses the current Supabase secret-key flow (`auth: 'secret'`), so
Cron sends the encrypted `atlas_automation_key` from Vault in the `apikey`
header. Its project URL is stored as `atlas_project_url`. The two idempotent
schedules are:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname in ('learning_reflection', 'learning_consolidation');

select cron.schedule(
  'learning_reflection',
  '30 18 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'atlas_project_url')
      || '/functions/v1/learning-reflection',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'atlas_automation_key')
    ),
    body := jsonb_build_object('weekly', false),
    timeout_milliseconds := 60000
  );
  $$
);

select cron.schedule(
  'learning_consolidation',
  '0 20 * * 0',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'atlas_project_url')
      || '/functions/v1/learning-reflection',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'atlas_automation_key')
    ),
    body := jsonb_build_object('weekly', true),
    timeout_milliseconds := 60000
  );
  $$
);
```

---

## Job status view

```sql
create or replace view private.job_status as
select distinct on (job_name)
  job_name, status, started_at, completed_at, duration_ms, error_code
from private.job_runs
order by job_name, started_at desc;
```

Surfaced read-only in **Settings → System**, showing each job's most recent run,
outcome and duration. A job that has not run when it should have is visible
there rather than discovered weeks later.

---

## Failure handling

| Failure | Response |
|---|---|
| Google disconnected | Skip Google steps, complete the rest, state the gap plainly |
| Gemini unavailable | Mark `failed`, retry on the next scheduled run — no immediate hammering |
| Timeout | Mark `failed` with `error_code = 'timeout'`; the claim prevents a partial re-run |
| Partial success | Record what succeeded; never present partial output as complete |
| Repeated failure | Circuit breaker halts attempts and surfaces a clear degraded state |

Jobs never retry infinitely. The next scheduled run is the retry.

---

## Local testing

Invoke a function directly, without waiting for cron:

```bash
supabase functions serve daily-briefing --env-file .env.local

curl -i -X POST http://localhost:54321/functions/v1/daily-briefing \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"scheduled": true}'
```

Then run it **twice** and confirm the second invocation exits without producing
a second briefing. That is the test that matters.

Tail production logs while testing:
```bash
supabase functions logs daily-briefing --tail
```

---

## Adding a job

1. Add it to the catalogue table above **first**.
2. Implement the claim pattern before any other logic.
3. Make the body idempotent regardless of the claim.
4. Set a hard timeout.
5. Record success and failure in `private.job_runs`.
6. Schedule it in UTC, with the Singapore equivalent noted.
7. Test double invocation.
8. Confirm it appears in the job status view.
