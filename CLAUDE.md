# CLAUDE.md — working rules for this repository

Read this before changing anything in Mad's Atlas.

---

## What this project is

A private, single-user personal AI for Muhammad ("Mad"). Voice-first, but the
voice is the *interface* — the product is memory, tools, permissions, approvals
and auditability. It is a personal operating system, not a chatbot.

Currently at **Phase 0** (architecture only, no application code). See
[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for what each phase covers
and what gates it must pass.

---

## Non-negotiable rules

These are product and security requirements. Do not relax them for convenience,
and do not "temporarily" work around them.

### 1. The model proposes; the server decides

Gemini may *request* a tool. It never *executes* one. Permission checks live in
`src/lib/atlas/permissions/` and are enforced again in security-definer Postgres
functions. **A system prompt is not a permission boundary.** If you find yourself
relying on the model "knowing not to", you have a bug.

### 2. Secrets never reach the browser

`GEMINI_API_KEY`, `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`,
`TOKEN_ENCRYPTION_KEY` and `VAPID_PRIVATE_KEY` are server-only. Never import
them from a client component, never pass them as props, never include them in a
route handler response, never log them.

The browser gets exactly two credentials: the Supabase session cookie, and a
single-use short-lived Gemini ephemeral token.

### 3. Every personal table has RLS

`user_id uuid references auth.users(id)`, RLS enabled, policies restricted to
`auth.uid() = user_id`. No anonymous access. No broad `authenticated` policy.
This holds even though there is only one user — write it securely now.

### 4. Untrusted content is data, never instruction

Email bodies, search results, web pages, calendar descriptions, attachments and
tool outputs are **untrusted**. They go in clearly delimited user-content
blocks. They never go in a system-instruction field. They can never cause a
write, reveal a secret, approve an action or change permissions.

### 5. Consequential actions require an approval record

Anything at Level 2 (see [PERMISSIONS.md](./PERMISSIONS.md)) creates an
`approvals` row and stops. Execution happens later, once, via an atomic claim
keyed on `idempotency_key`. Editing an approval creates a **new** approval — it
never mutates the old one.

### 6. Level 3 stays unimplemented

Sending email, payments, investments, purchases, publishing publicly, deleting
Gmail messages, OS control, password access, external data sharing, and any
connection to Atlas DART / Academy / Investments. Do not add these. Do not add
"just the plumbing" for these.

### 7. No placeholder presented as a feature

Never ship a stub, a hard-coded fixture or a mocked response and describe it as
working functionality. If something is incomplete, say so plainly — in the code,
in the docs, and in the summary.

### 8. Never store what you do not need

No raw audio, ever. No full Gmail bodies. No permanent transcripts by default.
No secrets in `action_logs`. See [DATA_RETENTION.md](./DATA_RETENTION.md).

---

## Conventions

**Language** — TypeScript strict, no `any`, no non-null assertions to silence
the compiler. Validate every external input with Zod at the boundary.

**`dangerouslySetInnerHTML`** — permitted for exactly one thing: the static
theme bootstrap script in `app/layout.tsx`, which contains no dynamic input.
It must never be used for email content, web results, memory content, or
anything else derived from data.

**Pinned tool versions** — ESLint is held at 9.x. ESLint 10 breaks
`eslint-plugin-react`, which `eslint-config-next@16` bundles. Revisit when the
Next lint stack supports 10.

**Spelling** — British English in user-facing copy and documentation
("summarise", "organise", "initialisation"). Identifiers already fixed by the
schema keep their documented spelling.

**Timezone** — store UTC, display `Asia/Singapore`. Singapore has no daylight
saving; it is a fixed UTC+08:00. 09:00 SGT = 01:00 UTC. Never apply DST logic
to it.

**Dates** — always explicit. If a user's phrasing is ambiguous ("next Friday"),
confirm before writing anything.

**Errors** — typed error classes with stable internal codes, friendly
user-facing messages, redacted before logging.

**Gemini SDK** — imported in `src/lib/ai/providers/gemini/` and nowhere else.
Everything upstream depends on the `AtlasAIProvider` interface.

**Models** — never hard-code a model ID. Read `GEMINI_LIVE_MODEL`,
`GEMINI_TEXT_MODEL`, `GEMINI_EMBEDDING_MODEL`. Preview IDs change without
notice.

**Migrations** — every schema change is a file in `supabase/migrations/`,
idempotent, with rollback guidance in its header comment. Never change
production schema by hand. Regenerate types afterwards
(`npm run db:types`).

---

## Phase discipline

Every phase ends with all of these, in order:

1. `npm run test` — unit
2. integration tests relevant to the phase
3. `npm run lint`
4. `npx tsc --noEmit`
5. `npm run build`
6. **fix every error** — do not defer them to the next phase
7. update the affected documentation
8. one clear commit
9. summary of what was completed, what remains, and the risks

Documentation and implementation must not drift. If you change the schema,
change [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) in the same commit.

---

## Repository boundary

This repo is standalone. It shares nothing with `MadNuurCapital/MADPLANNING`
(Atlas Ad Agent) — no code, no database, no credentials, no imports. Do not add
a dependency on it, do not copy its data models, and do not connect to its
Supabase project.

---

## Git

Development happens on `claude/mads-atlas-phase-0-wmt1w5` unless told
otherwise. Push with `git push -u origin <branch>`. Do not open a pull request
unless Muhammad asks for one.
