# ATLAS LEARNING & EVOLUTION REPORT

**Release:** Self-Learning & Evolution Engine

**Date:** 8 August 2026

**Status:** Implemented and locally verified; not deployed

## Outcome

Mad’s Atlas now has a real, database-backed learning loop that preserves the
existing explicit Memory contract. It learns only from meaningful successful
tool outcomes, explicit memories and feedback; tracks evidence and confidence;
detects privacy-safe workflows; decays stale inferences; aggregates system
health; applies only reversible, owner-enabled behavioral adaptations; and
creates inert improvement proposals that it cannot execute.

No existing voice, task, reminder, Calendar, Gmail, research, approval or
memory table was rebuilt. Google permissions and token handling were not
changed.

## Architecture delivered

### User learning model

- Categories: facts, preferences, routines, people, projects, goals, decisions,
  workflows, communication, research, productivity and system.
- Types: observation, inference, confirmed-memory sidecar, system insight,
  workflow and decision.
- Lifecycle: observed → emerging → suggested → confirmed/active, with retired,
  superseded and dismissed terminal paths.
- Canonical keys deduplicate repeated signals.
- Evidence is bounded to twelve recent safe references while total evidence
  count remains available.
- Explicit correction supersedes the old item and preserves history.
- Confirmed and pinned knowledge never decays.

### Confidence and proactivity

- Diminishing-return reinforcement prevents repetition from instantly becoming
  certainty.
- Suggestions require both confidence and repeated evidence.
- Stale unconfirmed items decay after a grace window with an approximately
  180-day half-life.
- Proactivity considers relevance, urgency, confidence and interruption cost.
- Small health samples are labelled `watch`, not treated as conclusions.

### Workflow learning

- Uses only recent successful tool names and outcomes.
- Does not store task text, email bodies, calendar descriptions or raw tool
  payloads.
- Requires at least two distinct steps before a workflow observation exists.
- Repetition moves it through observed/emerging/suggested; owner confirmation
  is required before it becomes active.

### Voice and context

- `memory.search` now returns compact confirmed memory plus relevant
  confirmed/active learning.
- `memory.remember` preserves existing behavior and writes a best-effort
  confirmed learning sidecar.
- `learning.feedback` supports useful, not useful, confirm, correct and dismiss.
- Only up to five active low-risk communication instructions enter a voice
  session. The full user model is never dumped into a prompt.
- Learning-table rollout failure degrades to the existing Memory behavior.

### Reflection, diagnosis and evolution

- Daily 24-hour and weekly seven-day deterministic reflection.
- Real subsystem failure-rate, latency, sample-count, window and health rows.
- Degraded metrics need at least five samples before a proposal is created.
- Proposals include evidence, confidence, solution, benefit, risk, affected
  systems and tests.
- Proposal text is copy/export only. There is no execution, code-edit, shell,
  push, merge or deploy capability.

## Database changes

Migration: `supabase/migrations/20260808000013_learning_evolution.sql`

Additive tables:

1. `learning_items`
2. `learning_feedback`
3. `atlas_adaptations`
4. `system_metrics`
5. `evolution_proposals`

All five have RLS. Learning, adaptations and proposals are owner-scoped.
Feedback is owner-readable/insertable and immutable. Metrics are owner-readable
but server-written. `anon` has no access.

New settings:

- `learning_enabled` — on
- `learning_paused_until` — null
- `proactive_suggestions_enabled` — on
- `workflow_learning_enabled` — on
- `system_diagnostics_enabled` — on
- `automatic_adaptations_enabled` — **off**

`reset_learning_engine()` removes only inferred learning state. A profile-delete
trigger extends the existing complete-deletion transaction to all five new
tables. `export_learning_data()` provides the additive data-rights export.

## Product surfaces

- New `/evolution` page in desktop navigation and mobile More.
- Learned-about-me, recent learning, confidence/evidence, real system health,
  adaptations with revert, and copyable improvement proposals.
- Useful, not useful, confirm and forget feedback controls.
- Two-step inferred-learning reset that preserves confirmed Memory.
- Settings toggles for each learning subsystem and a 24-hour pause.
- Privacy counts include all five new data categories.

## Privacy and safety

- Raw audio remains unstored.
- Full Gmail bodies remain unstored.
- Tokens and secrets remain outside the learning tables.
- Private keys, password/OTP labels, API-key-like strings and payment-card
  patterns are refused by the learning input boundary.
- System metrics store aggregate mechanics only.
- Automatic adaptation is off by default and limited in code to confirmed,
  low-risk, prompt-only communication behavior.
- Google integrations, scopes and token envelopes were unchanged.

## Cost impact

| Activity | AI calls | Database work |
|---|---:|---:|
| Page view / UI click | 0 | none for ordinary navigation |
| Meaningful successful tool action | 0 | small settings/read/upsert sidecar |
| Explicit learning feedback | 0 | one update + immutable feedback insert |
| Daily reflection | 0 | one bounded aggregate pass |
| Weekly consolidation | 0 | one bounded seven-day aggregate pass |
| Evolution proposal | 0 | deterministic insert after threshold |

Steady-state incremental AI cost is **$0**. Existing semantic-memory embedding
cost is unchanged. The reflection query is capped at 5,000 log rows and 1,000
learning items per owner per run; UI and context queries are also bounded.

## Verification

- ESLint: pass
- TypeScript: pass
- Unit tests: **216 passed**
- Production build: pass, including `/evolution`
- Security audit: pass, no issues found
- Browser suite: **39 passed, 3 intentionally skipped** across desktop,
  mobile Chromium and mobile Safari
- Integration suite without local PostgreSQL: **19 passed, 82 skipped**
- New database integration coverage added for RLS isolation, constraints,
  safe reset and read-only metrics

The database-backed cases could not execute locally because this Mac does not
have PostgreSQL server/pgvector binaries. They remain testable with
`scripts/local-db.sh` in CI or a prepared development environment. The migration
must be applied in Supabase before the new toggles persist or scheduled metrics
appear.

## Release procedure (manual, no deployment performed)

1. Apply migration `20260808000013_learning_evolution.sql` in Supabase.
2. Deploy the `learning-reflection` Edge Function.
3. Add daily and weekly Cron invocations from `SCHEDULED_JOBS.md`.
4. Deploy the application through the existing Netlify workflow.
5. Sign in, open Settings → Learning & evolution, and verify saved toggle state.
6. Run one manual daily reflection invocation, then open Evolution and verify
   real metrics—not seeded examples—appear.
7. Keep automatic low-risk adaptations off until you have reviewed at least one
   confirmed communication preference.

## Honest initial state

Evolution intentionally starts empty. No fake patterns, metrics, baselines or
proposals were seeded. Learning becomes visible only after real usage and the
first reflection run. This is expected and is evidence that Atlas is not
pretending to know what it has not observed.
