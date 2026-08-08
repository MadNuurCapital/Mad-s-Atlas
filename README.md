# Mad's Atlas

Muhammad's private personal AI. A voice-first personal operating system with real
memory, real tools, hard permission boundaries and an approval gate on every
consequential action.

**This application is exclusively for Muhammad.** Exactly one email address can
ever sign in.

---

## Status

| Phase | Scope | State |
|---|---|---|
| **0** | Architecture, database design, threat model, contracts, setup guides | ✅ Complete |
| **1** | Next.js foundation, design system, navigation, env validation, health check | ✅ Complete |
| **2** | Auth, owner allowlist, migrations, Row Level Security | ✅ Complete |
| **3** | Tasks, recurrence engine, action log, redaction | 🟡 Partial |
| **4** | Memory: four layers, suggest/confirm, hybrid search, versions, export | ✅ **Complete — this commit** |
| **5** | Gemini Live voice: ephemeral tokens, PCM audio, session lifecycle, budgets | 🟡 **Implemented; live deploy-preview verification pending** |
| **6** | Permission engine, tool registry, approval gate | 🟡 **Core complete — this commit** |
| **7** | Google: token refresh, Gmail, Calendar, tool definitions | 🟡 **Complete pending Google credentials — this commit** |
| **8** | Grounded research: routing, source extraction, SSRF-safe URLs | 🟡 **Complete pending a Gemini key — this commit** |
| **9** | Edge Functions, job claim ledger, briefing, reminders, retention | 🟡 **Complete pending a Supabase project — this commit** |
| **10** | Prompt-injection suite, secret scanning, security audit script | 🟡 **Complete pending deployment — this commit** |

The documents in this repository are the specification that later phases
implement against — the schema is argued on paper before it becomes a migration
that is expensive to change.

### What has actually been verified

Kept deliberately explicit, because "written" and "proven to work" are not the
same thing and only one of them is worth trusting.

| Area | Status |
|---|---|
| Schema, RLS, approval claim, refresh-token guard, memory, job idempotency | ✅ Executed against a real PostgreSQL 16 + pgvector database. 86 integration tests |
| Owner verification, email normalisation, env contract, timezone handling | ✅ 35 unit tests; SQL and TypeScript normalisation compared on identical input |
| Recurrence, log redaction, research routing, URL safety, source extraction | ✅ 166 unit tests total |
| Permission decisions, Level 3 absence, payload hashing | ✅ 37 unit tests |
| Prompt-injection resistance | ✅ 26 unit tests over 7 realistic payloads |
| Unauthenticated access control, secret containment | ✅ 22 end-to-end checks across desktop and mobile viewports |
| Token encryption, refresh-token preservation, no-send boundary | ✅ 15 further unit tests |
| Live Gmail / Calendar API calls | ⬜ Not yet — needs a Google OAuth client. Encryption, refresh logic and permission levels ARE tested |
| Gemini Live WebSocket transport | 🟡 Constrained-token protocol, 16 kHz microphone input, 24 kHz playback, transcripts, capped resumption and teardown are tested; final live conversation check is required after deploy |
| Deployment to Netlify | ✅ Production health endpoint is live and reports complete configuration |

The local database harness is `bash scripts/local-db.sh start`. It applies every
migration to a throwaway cluster so the security properties are tested rather
than asserted — see [TESTING.md](./TESTING.md).

---

## What it does

Mad's Atlas helps Muhammad understand his day, talk naturally through realtime
voice, research current information with real sources, review his calendar,
search and summarise Gmail, prepare email drafts, capture tasks, reminders and
ideas, remember confirmed personal information, prepare before meetings,
recommend the most important next action, carry out approved personal actions,
and keep a clear history of everything it has done.

The voice is only the interface. The product is the intelligence, memory,
tools, permissions and actions behind it.

### What it deliberately does not do

- **Never sends email.** Drafts only, and only after approval.
- **Never touches Atlas DART, Atlas Academy, Atlas Investments,** client- or
  advisor-management systems, or any financial advisory or company database.
  Mad's Atlas may *know these projects exist* if Muhammad saves that as a
  personal memory. It has no path to their data.
- **Never listens in the background.** No always-on microphone. No stored audio.
- **Never executes financial transactions, payments or investments.**
- **Never acts on instructions found inside emails, web pages or calendar
  descriptions.** That content is data, not command.

---

## Architecture at a glance

```
Browser ──► Next.js on Netlify ──► Supabase Postgres (RLS)
   │              │                      ▲
   │              ├──► Gemini text ──────┤
   │              └──► Google APIs ──────┤
   │                                     │
   └──► Gemini Live (WebSocket)     Edge Functions ◄── Supabase Cron
        via ephemeral token only
```

The browser holds two credentials and no more: a Supabase session cookie and a
single-use, model-locked, short-lived Gemini ephemeral token. The permanent
Gemini key, the Supabase secret key, the Google tokens and the encryption key
never leave the server.

Full detail: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Technology

Next.js 16 App Router · TypeScript strict · Tailwind · Supabase (Postgres, Auth,
RLS, Realtime, Storage, Edge Functions, Cron) · pgvector · PostgreSQL full-text
search · Gemini Live API · Gemini with Google Search grounding · Gmail API ·
Google Calendar API · Netlify · Zod · Vitest · Playwright

Authentication uses `@supabase/ssr`. The deprecated Supabase Auth Helpers are
not used.

### iPhone / PWA

Atlas ships an App Router web manifest, Apple standalone metadata, safe-area
layout support, and canonical regular/maskable icons adapted from the official
gold A + orbit artwork. It intentionally has no offline service worker: private
calendar, memory, research, and authenticated server-rendered content must not
be cached indiscriminately. Add the production site to the iPhone Home Screen
for the standalone application viewport.

---

## Documentation

Start here, in this order:

| Document | Read it for |
|---|---|
| [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md) | What is being built and what "done" means |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System boundaries and the request lifecycle |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | Every table, constraint, index and RLS policy |
| [SECURITY.md](./SECURITY.md) | Threat model and the controls for each threat |
| [PERMISSIONS.md](./PERMISSIONS.md) | What Atlas may do alone, what needs approval, what is forbidden |
| [MEMORY_SYSTEM.md](./MEMORY_SYSTEM.md) | The four memory layers and hybrid retrieval |
| [DATA_RETENTION.md](./DATA_RETENTION.md) | What is stored, for how long, and how to delete it |

Setup, in the order you will need it:

| Document | Read it for |
|---|---|
| [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) | Project creation, CLI, migrations, extensions |
| [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) | OAuth client, scopes, consent screen |
| [GEMINI_LIVE_SETUP.md](./GEMINI_LIVE_SETUP.md) | API key, ephemeral tokens, voice session model |
| [NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md) | Environment variables, deploy, verification |
| [SCHEDULED_JOBS.md](./SCHEDULED_JOBS.md) | Cron jobs, UTC/Singapore times, idempotency |

Working on the code:

| Document | Read it for |
|---|---|
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | Phase-by-phase scope and exit gates |
| [TESTING.md](./TESTING.md) | Test strategy and the 30 required end-to-end scenarios |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Symptom → cause → fix |
| [CLAUDE.md](./CLAUDE.md) | Rules for AI assistants working in this repo |

---

## Getting started

```bash
cp .env.example .env.local     # then fill it in
npm install
npm run dev
```

Useful commands:

```bash
npm run verify        # lint + typecheck + unit tests + production build
npm run test          # unit tests
npm run test:e2e      # end-to-end (builds and serves the app)
npm run lint
npm run typecheck
```

Before the app will do anything useful you must complete the external setup —
Supabase project, Google OAuth client, Gemini API key, owner seeding. The
ordered checklist with exact commands is in
[SUPABASE_SETUP.md](./SUPABASE_SETUP.md) § Setup checklist.

### One thing to get right early

Muhammad signs in with a personal `@gmail.com`, so the Google OAuth app is type
**External**. While an External app sits in **Testing** status, Google expires
the refresh token **every 7 days** — which would silently stop the daily
briefing and meeting preparation each week.

**Publish the OAuth app to Production status.** Details and the exact steps are
in [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) § Testing vs Production.

---

## Repository boundary

This repository is standalone. It shares no code, no database, no credentials
and no runtime with `MadNuurCapital/MADPLANNING` (Atlas Ad Agent) or any other
Atlas property. That separation is a product requirement, not an accident of
layout — see [SECURITY.md](./SECURITY.md) § Cross-system isolation.
