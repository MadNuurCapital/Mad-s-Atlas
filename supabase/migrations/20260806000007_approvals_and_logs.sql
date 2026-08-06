-- =============================================================================
-- 0007 — Approvals, action logs and tool runs
-- =============================================================================
--
-- Purpose:
--   The gate every consequential action passes through, plus the audit trail.
--   Every constraint here exists to make double execution IMPOSSIBLE rather
--   than unlikely.
--
-- Rollback:
--   drop table if exists public.tool_runs;
--   drop table if exists public.action_logs;
--   drop table if exists public.approvals;
--   -- Destroys the audit trail. Consider exporting it first.
--
-- =============================================================================

create table if not exists public.approvals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  action_type   text not null,
  title         text not null,
  reason        text not null,

  -- Exactly what will be executed. Not a description of it.
  proposed_payload jsonb not null,
  -- SHA-256 of the canonicalised payload, checked immediately before the
  -- external call. A mutated payload cannot match, so it cannot execute.
  payload_hash  text not null,
  affected_data jsonb not null default '{}'::jsonb,

  status        text not null default 'pending',
  idempotency_key text not null,

  requested_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  approved_at   timestamptz,
  rejected_at   timestamptz,
  executed_at   timestamptz,
  execution_result jsonb,

  -- An edit creates a NEW approval pointing back at the one it replaces. The
  -- original is rejected and can never execute the new payload.
  supersedes_approval_id uuid references public.approvals(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint approvals_status_check check (status in (
    'pending', 'approved', 'rejected', 'expired', 'executed', 'failed'
  )),
  constraint approvals_idempotency_unique unique (idempotency_key),
  constraint approvals_expiry_after_request check (expires_at > requested_at),
  constraint approvals_executed_has_timestamp check (
    status <> 'executed' or executed_at is not null
  )
);

comment on table public.approvals is
  'Every Level 2 action waits here. An approval executes at most once, only '
  'while approved and unexpired, and only with the exact payload approved.';
comment on column public.approvals.proposed_payload is
  'The literal payload that will be executed. Shown verbatim in the UI.';
comment on column public.approvals.payload_hash is
  'SHA-256 of the canonicalised payload. Verified before the external call so '
  'a tampered payload is refused rather than executed.';
comment on column public.approvals.idempotency_key is
  'Globally unique. The claim in public.claim_approval() turns on this.';
comment on column public.approvals.execution_result is
  'Redacted summary of the outcome. Never a token or a full email body.';

create index if not exists approvals_pending_idx
  on public.approvals (user_id, status, expires_at);

create index if not exists approvals_recent_idx
  on public.approvals (user_id, requested_at desc);


-- -----------------------------------------------------------------------------
-- Action logs — the audit trail
-- -----------------------------------------------------------------------------
-- WHAT Atlas did, never the sensitive content it touched.

create table if not exists public.action_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  session_id     uuid,
  tool_name      text not null,
  operation_type text not null,
  action_summary text not null,
  status         text not null,
  approval_id    uuid references public.approvals(id) on delete set null,
  duration_ms    integer,
  error_code     text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  constraint action_logs_operation_check check (operation_type in (
    'read', 'analyse', 'propose', 'execute', 'refuse'
  )),
  constraint action_logs_status_check check (status in (
    'success', 'failure', 'refused', 'timeout'
  ))
);

comment on table public.action_logs is
  'Append-only audit trail. MUST NOT contain API keys, OAuth tokens, '
  'passwords, full email bodies, raw audio, or memory content. Summaries and '
  'identifiers only — a redaction helper is applied at every call site.';
comment on column public.action_logs.metadata is
  'Counts and identifiers only. Never payloads.';

create index if not exists action_logs_recent_idx
  on public.action_logs (user_id, created_at desc);
create index if not exists action_logs_tool_idx
  on public.action_logs (user_id, tool_name, created_at desc);
create index if not exists action_logs_status_idx
  on public.action_logs (user_id, status, created_at desc);


-- -----------------------------------------------------------------------------
-- Tool runs — execution mechanics, kept separate from the audit trail
-- -----------------------------------------------------------------------------

create table if not exists public.tool_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid,
  tool_name       text not null,
  input_summary   text,
  output_summary  text,
  status          text not null default 'running',
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  error_code      text,
  retry_count     integer not null default 0,
  created_at      timestamptz not null default now(),

  constraint tool_runs_status_check check (status in (
    'running', 'succeeded', 'failed', 'cancelled', 'timeout'
  ))
);

comment on table public.tool_runs is
  'Mechanics of tool execution: timing, retries, outcome. Summaries are '
  'redacted before they are written.';

create index if not exists tool_runs_recent_idx
  on public.tool_runs (user_id, started_at desc);


drop trigger if exists approvals_set_updated_at on public.approvals;
create trigger approvals_set_updated_at before update on public.approvals
  for each row execute function private.set_updated_at();
