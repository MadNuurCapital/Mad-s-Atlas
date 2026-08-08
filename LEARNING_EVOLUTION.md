# Atlas Learning & Evolution Engine

Atlas now has a separate, evidence-backed learning layer. It improves continuity
and reliability without allowing an inference to masquerade as a fact, and
without giving the system permission to rewrite or deploy itself.

## Trust model

The existing `memories` table remains the canonical source for personal facts
Atlas may rely on. The new `learning_items` table distinguishes:

- `observation` — one meaningful signal;
- `inference` — a pattern supported by repeated evidence;
- `confirmed_memory` — a sidecar reference to something explicitly remembered;
- `workflow` — a tool-name sequence, never a retained private payload;
- `decision` — an explicitly retained decision;
- `system_insight` — a diagnostic conclusion from aggregate metrics.

An inferred item follows `observed → emerging → suggested`. It becomes
`confirmed` only after explicit owner confirmation. A workflow becomes `active`
only after confirmation. Anything can be dismissed, retired or superseded, and
correction retains the older item as history.

## Evidence and confidence

Every item has a canonical deduplication key, confidence from 0–1, a bounded
list of the twelve most recent safe evidence references, total evidence count,
first/last observation times and review state.

Independent evidence raises confidence with diminishing returns. A suggestion
requires at least five signals and 0.72 confidence. Stale, unconfirmed
inferences decay after a grace period with an approximately 180-day half-life;
confirmed and pinned items never decay. Secret-like content, authentication
codes, private keys and payment-card patterns are refused before a learning row
is written.

Proactivity is deliberately conservative:

```text
score = 0.34 relevance + 0.28 urgency + 0.30 confidence
        - 0.24 interruption cost
```

The UI does not interrupt on raw observations. Suggestions remain reviewable in
Evolution, with `Useful`, `Not useful`, `Confirm` and `Forget` controls.

## Context and voice

`memory.search` retrieves a compact combination of relevant confirmed memories
and confirmed/active learning. It never injects the whole user model into a
voice session. `memory.remember` keeps its established behavior and adds a
best-effort confirmed learning sidecar. `learning.feedback` lets a spoken
confirmation, correction or dismissal update the evidence model. Corrections
supersede the older item rather than silently overwriting history.

Only confirmed, low-risk communication adaptations are passed into the voice
system instruction. The cap is five short instructions per session.

## Reflection and diagnostics

`learning-reflection` is a Supabase Edge Function with two cadences:

- Daily: aggregate the previous 24 hours, refresh lifecycle and decay.
- Weekly: aggregate seven days and consolidate the same bounded model.

The function makes **zero AI calls**. It reads redacted `action_logs` and stores
only subsystem, failure rate, latency, sample count, time window and health.
Small samples are marked `watch`, not treated as conclusions. A degraded signal
needs at least five samples before it may create a proposal.

## Adaptations and proposals

Automatic adaptation is off by default. When enabled, the only implemented
automatic adaptation is an explicitly confirmed communication preference. It
is low risk, prompt-only, visible, and reversible.

`evolution_proposals` contains inert review text with evidence, confidence,
benefit, risk, affected systems and a test plan. Atlas can copy/export that
text. No learning code path can:

- execute code or shell commands;
- edit production code;
- change permissions or integrations;
- push, merge, deploy or publish;
- perform financial actions.

## Storage and cost

Five additive tables are used because their retention and permissions differ:
`learning_items`, `learning_feedback`, `atlas_adaptations`, `system_metrics`
and `evolution_proposals`. All are owner-scoped with RLS. Aggregate metrics are
server-written and client-read-only.

Steady-state AI cost is **$0 for the learning loop**. Tool observations add at
most two small database reads and one upsert after a meaningful successful tool
action. Daily/weekly reflection is one bounded Edge invocation and aggregate
database work. No model call occurs on a click, page view, tool observation,
reflection or consolidation. Existing embeddings remain the only optional AI
cost associated with semantic memory.

## Operations

1. Apply migration `20260808000013_learning_evolution.sql`.
2. Deploy the `learning-reflection` Edge Function.
3. Schedule daily and weekly calls exactly as documented in
   `SCHEDULED_JOBS.md`.
4. Open Settings → Learning & evolution and choose the owner-controlled
   toggles. Automatic adaptation remains off unless explicitly enabled.
5. Open Evolution after the first scheduled run to verify health signals.

Reset requires two clicks and deletes only inferred learning, feedback,
diagnostics, adaptations and proposals. It leaves confirmed memories, tasks,
Google Calendar, Gmail connection data and the audit trail intact.
