# Implementation Plan — Mad's Atlas

Eleven phases. Each has an entry condition, a scope, and an exit gate that must
pass before the next begins.

---

## The gate every phase must pass

No exceptions, no deferrals to "the next phase":

```
1  npm run test              unit
2  npm run test:integration  integration relevant to this phase
3  npm run lint
4  npx tsc --noEmit
5  npm run build             production build
6  fix every error           not "note them for later"
7  update affected docs      in the same commit as the code
8  one clear git commit
9  summarise: completed, remaining risks, next phase
```

**No placeholder may be presented as completed functionality.** If something is
a stub, the summary says so.

---

## Phase 0 — Architecture ✅

**Delivered:** repository inspection, product requirements, architecture,
database design, threat model, permission matrix, memory design, directory
structure, environment contract, setup guides, scheduled-job catalogue,
retention policy, test strategy, this plan.

**Deliberately not delivered:** any application code. The schema is argued on
paper before it becomes a migration that is expensive to change.

**Exit:** presented and approved.

---

## Phase 1 — Foundation

**Entry:** Phase 0 approved.

### Scope

1. **Scaffold.** Next.js 16.3 App Router, TypeScript strict, Tailwind, React 19.
   Verify the Netlify adapter builds a trivial app **before** adding anything
   else — if Next 16 misbehaves with the adapter, pin to 15.x now rather than
   discovering it in Phase 10.
2. **TypeScript.** `strict: true`, `noUncheckedIndexedAccess`, `@/*` path alias.
3. **Design system.** CSS-variable tokens: deep forest green, near-black
   charcoal, warm cream, muted gold, neutral greys. Light and dark. Typography
   scale, spacing, radii, elevation. Accessible focus states, large touch
   targets, reduced-motion support.
4. **App shell.** Desktop sidebar, mobile bottom navigation, across all eleven
   routes. Each route renders an honest empty state — no fake data.
5. **Environment validation.** `src/lib/validation/env.ts`, Zod, fails safely,
   never logs a value.
6. **Supabase clients.** `client.ts`, `server.ts`, `admin.ts` on
   `@supabase/ssr`. `admin.ts` carries `import 'server-only'`.
7. **Health check.** `/api/health`, revealing nothing sensitive.
8. **Config.** `netlify.toml`, security headers, CSP.
9. **Test harness.** Vitest and Playwright configured, each with one real
   passing test.

### Exit gate
- The gate above passes
- The site deploys to Netlify and `/api/health` returns 200
- Navigation works on desktop and mobile
- Missing environment variables fail the build with a clear, value-free message

---

## Phase 2 — Authentication and database security

**Entry:** Phase 1 deployed.

### Scope

1. All migrations for the 18 tables in
   [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
2. RLS policies on every table
3. Triggers: `updated_at`, memory versioning, refresh-token protection,
   `handle_new_user`
4. Security-definer functions, all with `search_path = ''`
5. `private.allowed_users` and `private.check_user_allowed`
6. Before User Created hook, enabled and verified
7. Supabase Auth with Google, SSR cookie sessions
8. Server-side owner verification used by every protected route
9. `scripts/seed-owner.ts`, idempotent
10. `scripts/generate-types.ts`, types committed
11. `/sign-in` and the auth callback

### Exit gate
- The gate above passes
- The owner signs in; **a second Google account is rejected**
- The cross-user RLS isolation test passes
- Every table in `public` has RLS enabled and at least one policy
- Every security-definer function sets `search_path = ''`
- Protected routes redirect when signed out

**This is the most security-critical phase.** Do not proceed with a known gap.

---

## Phase 3 — Core personal data

**Entry:** Phase 2 complete, RLS verified.

### Scope

Profile and settings screens; tasks (list, today, upcoming, overdue, completed,
create, update, complete, delete); reminders (one-off and recurring, timezone
handling); ideas (capture through the full pipeline); the action log and
`/history` with filters; Supabase Realtime for tool-run progress.

### Exit gate
- CRUD works for tasks, reminders and ideas with RLS enforced
- Recurring reminders compute their next occurrence correctly in
  `Asia/Singapore`
- Timezone unit tests pass, including the no-DST assertions
- Realtime updates arrive and unsubscribe cleanly on unmount

---

## Phase 4 — Memory

**Entry:** Phase 3 complete.

### Scope

Memory CRUD with the four layers; suggest → confirm flow; full-text search;
pgvector search with the HNSW index; `search_memories_hybrid()`; the
`EmbeddingProvider` abstraction; asynchronous embedding generation; version
history; supersede; export; deletion; the `/memory` screen.

### Exit gate
- A memory saves successfully **with a null embedding** — the save is never
  blocked
- Full-text, vector and hybrid search all return sensible results
- Vector-search failure falls back to full-text **and says so**
- **Suggestions require confirmation; direct user facts and agreed plans may be remembered automatically when Memory is enabled**
- Editing writes a version row
- Export excludes token columns
- Deletion removes everything in the correct order

---

## Phase 5 — Gemini voice

**Entry:** Phase 4 complete.

### Scope

**Start by confirming the exact ephemeral-token SDK signature against the
installed `@google/genai` types.** Do not write the endpoint from documentation.

Then: `/api/gemini/live-token` with owner verification and rate limiting; the
browser Live client; microphone permission handling; push-to-talk; optional
hands-free; live transcripts; interruption; session resumption; the seven voice
states; latency indicators; text fallback; the `/talk` screen.

### Exit gate
- **The permanent Gemini key appears nowhere in browser traffic** (E2E)
- The token endpoint rejects unauthenticated and non-owner requests
- A voice session starts, responds, and can be interrupted
- A network drop shows `reconnecting` and recovers
- Text fallback works
- Ending a session turns off the browser microphone indicator
- No audio is stored anywhere

---

## Phase 6 — Orchestrator and tools

**Entry:** Phase 5 complete.

### Scope

`src/lib/atlas/orchestrator/`; the tool registry; the permission engine; Zod
validation per tool; approval creation and the atomic claim; the `/approvals`
screen with approve, reject and edit; action logging; typed errors; idempotency;
timeouts, abort and cancellation; budget guardrails; the system, tasks,
reminders, memory, ideas, approvals and notifications tool families.

### Exit gate
- **An approval cannot execute twice**
- **An expired approval cannot execute**
- Editing creates a new approval; the old one cannot execute
- Level 3 tools are absent from the registry entirely
- Invalid tool input is refused, not coerced
- Budget exhaustion produces a graceful refusal
- Every execution writes an action log

---

## Phase 7 — Google integrations

**Entry:** Phase 6 complete.

### Scope

AES-256-GCM token encryption; token storage and refresh; **refresh-token
preservation**; the reconnect flow; Gmail search, thread retrieval,
summarisation and action-required classification; draft proposal and approved
creation; Calendar today, upcoming, detail, availability; proposed and approved
create/update; meeting preparation; the `/inbox` and `/calendar` screens.

### Exit gate
- Encrypt/decrypt round-trips; tampered ciphertext fails
- **A re-login with no refresh token preserves the stored one**
- The database trigger rejects any update nulling a valid refresh token
- Refresh failure sets `needs_reconnection` and shows the banner
- Gmail search works; **no full body is persisted**
- Draft creation requires approval and appears in Gmail
- **There is no code path that sends email**
- Calendar event creation runs immediately when Muhammad requests it
- Prompt-injection payloads in email invoke no tool

---

## Phase 8 — Research

**Entry:** Phase 7 complete.

### Scope

Google Search grounding through a server-side Gemini text request; the
`research.*` tools; source extraction and validation; report and source storage;
current-information routing — anything containing "today", "current", "recent",
"latest", "this week", or concerning news, markets, prices, laws, weather,
products or recent AI models goes to live research, never to model knowledge;
the research report UI.

### Exit gate
- Time-sensitive questions route to research automatically
- Every report carries real sources with URLs
- **No citation is ever fabricated**
- A missing publication date is null, not invented
- Uncertainty and conflicting information are surfaced
- URL validation rejects private, loopback and metadata addresses
- The research call limit per request is enforced

---

## Phase 9 — Daily briefing and proactive features

**Entry:** Phase 8 complete.

### Scope

The `daily-briefing`, `check-reminders`, `meeting-preparation`,
`generate-embeddings` and `maintenance` Edge Functions; `private.job_runs` and
the claim pattern; all cron schedules; web push subscription and delivery; the
`/today` screen with the briefing; the job status view in Settings.

### Exit gate
- The briefing generates at 01:00 UTC / 09:00 SGT
- **Running the job twice produces one briefing**
- Reminders fire once, and recurring reminders advance correctly
- The same meeting is never prepared twice
- Push notifications require explicit browser permission
- Every job records a `job_runs` row, including on failure
- A disconnected Google produces a degraded briefing that **says** it is
  degraded

---

## Phase 10 — Hardening and deployment

**Entry:** Phase 9 complete.

### Scope

The full security audit checklist; the RLS audit; the prompt-injection suite;
accessibility (keyboard, screen reader, contrast, reduced motion); mobile Safari
verification; performance; cost-control verification; `scripts/security-check.ts`;
`npm audit`; production deployment; the full 30-scenario E2E run.

### Exit gate
- Every item in [SECURITY.md](./SECURITY.md) § Security audit checklist passes
- **All 30 E2E scenarios pass**
- No secret appears anywhere in git history
- `npm audit` reports no high or critical advisories
- Mobile Safari works, including voice
- Accessibility checks pass
- Cost limits are enforced and visible
- Production is deployed and verified

**V1 is done when this gate passes.** Not before.

---

## Sequencing rationale

Why this order, and not another:

- **Security before features.** Phase 2 comes before any personal data exists,
  because retrofitting RLS onto populated tables is how gaps survive.
- **Data before intelligence.** Phases 3–4 give the orchestrator something real
  to reason over. Building tools against empty tables produces tools that only
  work on fixtures.
- **Voice before the orchestrator.** Phase 5 proves the hardest integration
  early, while there is still room to change course. It is the piece most likely
  to surprise us.
- **Orchestrator before Google.** Phase 6 establishes the permission and
  approval machinery, so Phase 7's external writes land in a system that already
  gates them. The reverse order would mean writing Gmail code twice.
- **Proactive last.** Phase 9 depends on nearly everything else. Scheduled jobs
  that call half-finished tools are difficult to debug at 01:00 UTC.

---

## Standing risks

Carried across phases and reviewed at each gate.

| Risk | Severity | Mitigation | Phase |
|---|---|---|---|
| **Personal-Gmail OAuth in Testing expires refresh tokens weekly** | High | Publish to Production; connection state machine; visible reconnect; jobs degrade honestly | 7 |
| Restricted Gmail scopes may prompt verification | High | Single-user unverified-Production path; reconnect as fallback | 7 |
| Prompt injection via email | High | Structural separation; write tools gated by approval; dedicated test suite | 7, 10 |
| `gemini-3.1-flash-live-preview` is a preview ID | Medium | Env-driven everywhere; no hard-coded model strings | 5 |
| Live sessions drop at ~10 minutes | Medium | Session resumption as a requirement, not polish | 5 |
| Ephemeral-token SDK shape unverified from here | Medium | Confirm against installed types before writing the endpoint | 5 |
| Embedding dimension change needs a full re-embed | Medium | `EmbeddingProvider` abstraction; documented migration | 4 |
| Gemini cost runaway | Medium | Hard caps, bounded loops, usage dashboard | 6 |
| Next.js 16.3 is very new | Low | Verify the adapter in Phase 1; pin to 15.x if it misbehaves | 1 |
| Singapore timezone errors | Low | UTC storage, fixed +08:00, dedicated tests | 3 |

---

## When something goes wrong mid-phase

1. **Stop.** Do not build on top of a broken foundation.
2. **Diagnose.** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
3. **Fix properly.** No workaround that leaves the invariant broken.
4. **Test the fix.** Add a regression test for what broke.
5. **Document it** if the cause was a design gap rather than a slip.
6. **Then continue.**

A phase is not complete because most of it works.
