# Data Retention & Privacy — Mad's Atlas

What is stored, for how long, what is never stored, and how to remove it.

This document is the source of truth for the Privacy section in Settings. If one
changes, the other changes in the same commit.

---

## Never stored, under any circumstance

| Data | Why not |
|---|---|
| **Raw microphone audio** | Never captured to disk, never uploaded, never buffered beyond the live stream |
| **Full Gmail message bodies** | Only identifiers, metadata and short summaries are kept |
| **OAuth tokens in plain text** | Encrypted with AES-256-GCM, decryptable only server-side |
| **API keys or secrets in the database** | They live in environment configuration only |
| **Passwords** | Google handles authentication; Atlas never sees a password |
| **Full conversation transcripts by default** | Session-only unless explicitly saved |
| **Secrets in logs** | `action_logs` holds redacted summaries only |
| **Anything from Atlas DART, Academy, Investments, client or advisor systems** | No connection exists |

---

## Retention schedule

| Data | Retention | Enforced by |
|---|---|---|
| Voice audio | **Never stored** | Architecture — there is no write path |
| Voice transcripts | Session only, unless saved | Client-side; not persisted by default |
| Text messages | `conversation_retention_days`, default **30** | `purge_conversations` |
| Conversation summaries | Same window, configurable | `purge_conversations` |
| Confirmed memories | **Indefinite**, until deleted by Muhammad | — |
| Suggested memories | 30 days, then expire unreviewed | `expire_memories` |
| Temporary-context memories | Until `expires_at` | `expire_memories` |
| Memory versions | Kept while the memory exists | Cascade on delete |
| Tasks | Indefinite; soft-deleted rows purged after 90 days | `maintenance` |
| Reminders | Indefinite while active | — |
| Ideas | Indefinite | — |
| Approvals | 180 days after terminal state | `maintenance` |
| Action logs | **365 days** | `purge_action_logs` |
| Tool runs | 90 days | `maintenance` |
| Research reports | Indefinite, deletable | — |
| Research sources | With their report | Cascade |
| Daily briefings | 90 days | `maintenance` |
| Google tokens | Until disconnect or revocation | — |
| Push subscriptions | Until unsubscribed | — |
| Learning observations and inferences | Until dismissed/reset; stale unconfirmed items retire after decay | `learning-reflection` |
| Learning feedback | Until learning reset or account deletion | Owner control |
| Aggregate system metrics | Used as bounded health history; deletable by learning reset | `learning-reflection` |
| Adaptations and evolution proposals | Until reverted, dismissed or learning reset | Owner control |

Action logs get the longest window on purpose: they are the record of what Atlas
did on Muhammad's behalf, they contain no sensitive content by construction, and
a year is a reasonable period to be able to answer "what happened back then?".

---

## Email handling

Gmail is read, summarised and drafted against — but almost nothing is kept.

**Stored:**
- Gmail message or thread ID
- Sender
- Subject
- Date
- Labels
- Minimal action metadata (e.g. "needs a reply")
- A temporary summary, expiring with its conversation
- A draft approval reference

**Not stored:** full message bodies, attachments, recipient lists beyond what an
approval needs, or anything else.

Email content is fetched, processed **in memory**, and discarded when the
request completes. It is never written to a table, a cache or a log.

Email content is also **untrusted input** — see [SECURITY.md](./SECURITY.md)
§ T11. Instructions inside an email cannot cause any action.

---

## Voice handling

```
Microphone → browser audio stream → Gemini Live WebSocket
                                         ↓
                                    transcript
                                         ↓
                              displayed in the UI
                                         ↓
                             discarded at session end
                        (unless Muhammad explicitly saves it)
```

Audio never touches our servers. There is no code path that writes it anywhere.

Ending a session releases the media stream and the browser's microphone
indicator goes dark. The interface never shows "listening" while the microphone
is inactive.

---

## What the user controls

**Settings → Privacy** shows, in plain language:

- **Stored information** — every category, with live row counts
- **Retention periods** — this table, rendered from the same values the jobs use
- **Connected services** — Google account, scopes granted, connection status
- **Recent data access** — the last 50 actions from `action_logs`
- **Memory controls** — enable, disable, review, edit, delete
- **Export controls** — download everything
- **Deletion controls** — selective, or complete

### Adjustable settings

| Setting | Default | Range |
|---|---|---|
| `memory_enabled` | on | on/off |
| `conversation_retention_days` | 30 | 1–365 |
| `proactive_briefings_enabled` | on | on/off |
| `email_summary_enabled` | on | on/off |
| `calendar_preparation_enabled` | on | on/off |
| `notification_enabled` | **off** | on/off — requires browser permission |
| `approval_expiry_minutes` | 60 | 5–1440 |
| `meeting_prep_lead_minutes` | 30 | 5–240 |
| `learning_enabled` | on | on/off |
| `proactive_suggestions_enabled` | on | on/off |
| `workflow_learning_enabled` | on | on/off |
| `system_diagnostics_enabled` | on | on/off |
| `automatic_adaptations_enabled` | **off** | on/off; low-risk and reversible only |

Notifications default to off because they require an explicit browser permission
prompt, and a default-on setting that silently does nothing would be dishonest.

---

## Export

**Settings → Export**, or `memory.export_all`.

Produces a single JSON file containing profile and settings, all memories with
version history, tasks, reminders, ideas, approvals, action logs, conversations
and summaries, research reports with sources, daily briefings, and the additive
learning/evolution export from `export_learning_data()`.

**Excluded by construction, not by filtering:** encrypted token columns, the
encryption key, API keys, push subscription secrets. `export_all_user_data()`
never selects those columns, so they cannot be included by mistake.

The file is generated server-side and delivered via a short-expiry signed URL
from a private Storage bucket.

---

## Deletion

### Selective

- **A memory** — soft delete; recoverable from `memory_versions`
- **A task, reminder or idea** — soft delete where applicable
- **A conversation** — deletes it and its messages immediately
- **A research report** — deletes it and its sources
- **Inferred learning** — two-step reset deletes learning, metrics, adaptations
  and proposals while preserving confirmed Memory and operational data

### Complete

**Settings → Delete all Atlas data.**

Requires typing a confirmation phrase. States plainly that it is irreversible.

`delete_all_user_data()` runs in one transaction, deleting in foreign-key-safe
order:

```
conversation_messages → conversations
research_sources      → research_reports
memory_versions       → memories
action_logs, tool_runs, approvals
tasks, reminders, ideas
daily_briefings, notification_subscriptions
connected_accounts    (tokens destroyed)
user_settings, profiles
```

Afterwards, Muhammad is told to also revoke Google access at
<https://myaccount.google.com/permissions> — Atlas can delete its own copy of
the tokens, but only Google can revoke the grant on their side.

The Supabase Auth user is deleted last, if requested, which cascades anything
missed.

---

## What Atlas may know about other Atlas projects

Mad's Atlas may hold a memory such as "Muhammad runs Atlas Academy" — if
Muhammad states it and confirms it.

It has no access to Atlas Academy's data, no credential, no connection, and no
tool that could reach it. Knowing a project exists is not access to it, and the
distinction is enforced structurally rather than by policy.

---

## Verifying retention actually works

Run periodically, and as part of the Phase 10 audit:

```sql
-- Conversation messages past their retention date (expect 0)
select count(*) from public.conversation_messages
where retention_until < now();

-- Action logs older than a year (expect 0)
select count(*) from public.action_logs
where created_at < now() - interval '365 days';

-- Suggested memories older than 30 days (expect 0)
select count(*) from public.memories
where status = 'suggested' and created_at < now() - interval '30 days';

-- Approvals stuck pending past expiry (expect 0)
select count(*) from public.approvals
where status = 'pending' and expires_at < now();
```

Any non-zero result means a scheduled job is not running. Check the job status
view in Settings → System, and [SCHEDULED_JOBS.md](./SCHEDULED_JOBS.md).
