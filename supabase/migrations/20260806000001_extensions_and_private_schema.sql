-- =============================================================================
-- 0001 — Extensions, the private schema, and the owner allowlist
-- =============================================================================
--
-- Purpose:
--   Establish the extensions the rest of the schema depends on, create the
--   `private` schema (never exposed through the Data API), and put the owner
--   allowlist in place BEFORE any auth hook can reference it.
--
-- Rollback:
--   drop schema private cascade;
--   -- Extensions are left alone: dropping "vector" or "pg_cron" would break
--   -- anything else in the project that uses them.
--
-- =============================================================================

-- Extensions live in their own schema, never in `public`.
--
-- This is not tidiness. Every security-definer function in this schema sets
-- `search_path = ''` so it cannot be hijacked by a shadowing object — but that
-- also means operators and types must be schema-qualified, and a qualification
-- needs a STABLE schema to point at. Installing pgvector into `public` and
-- writing `embedding <=> query` produces a function that creates without
-- complaint and then fails at CALL time with "operator does not exist".
--
-- Pinning them here lets every reference be written as extensions.vector,
-- OPERATOR(extensions.<=>) and so on. This also matches Supabase's own
-- convention of keeping extensions out of `public`.

create schema if not exists extensions;
grant usage on schema extensions to public;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector"   with schema extensions;  -- semantic memory

-- If pgvector was enabled earlier into a different schema (the dashboard has
-- historically defaulted to `public`), `if not exists` above silently skips
-- and every `extensions.vector` reference then fails five migrations later
-- with a confusing "type does not exist". Move it, or say plainly why we
-- cannot.
do $$
declare
  v_schema name;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'vector';

  if v_schema is not null and v_schema <> 'extensions' then
    raise notice 'pgvector found in %, moving it to extensions', v_schema;
    execute 'alter extension vector set schema extensions';
  end if;
exception when others then
  raise exception
    'pgvector is installed in schema "%" but this schema expects it in '
    '"extensions", and it could not be moved (%). Fix it in the SQL editor '
    'with: alter extension vector set schema extensions;', v_schema, sqlerrm;
end
$$;
create extension if not exists "citext"   with schema extensions;  -- case-insensitive email
-- pg_cron and pg_net drive the SCHEDULED jobs only. They are Supabase-managed
-- and absent from a plain PostgreSQL. A missing scheduler must not stop the
-- whole schema from building: sign-in, memory, tasks and approvals do not
-- depend on them, and blocking those on a cron extension would turn a
-- degraded feature into a dead application.
do $$
begin
  create extension if not exists "pg_cron";
exception when others then
  raise warning
    'pg_cron unavailable (%). Scheduled jobs will not run until it is enabled '
    'in Database -> Extensions. Everything else works.', sqlerrm;
end
$$;

do $$
begin
  create extension if not exists "pg_net";
exception when others then
  raise warning
    'pg_net unavailable (%). Cron cannot call Edge Functions until it is '
    'enabled in Database -> Extensions. Everything else works.', sqlerrm;
end
$$;

-- gen_random_uuid() is in pg_catalog from PostgreSQL 13 onward, so DEFAULTs
-- resolve without depending on where pgcrypto landed.


-- -----------------------------------------------------------------------------
-- private schema
-- -----------------------------------------------------------------------------
-- Nothing here is reachable from a client at any privilege level. Confirm that
-- `private` is absent from Project Settings -> Data API -> Exposed schemas.

create schema if not exists private;

comment on schema private is
  'Server-only. Never add this schema to the exposed Data API schemas list.';

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;


-- -----------------------------------------------------------------------------
-- private.allowed_users — layer 1 of the owner restriction
-- -----------------------------------------------------------------------------
-- The Before User Created auth hook consults this table. An email that is not
-- present and enabled cannot become a user at all — the rejection happens
-- before a row exists in auth.users.

create table if not exists private.allowed_users (
  email      extensions.citext primary key,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.allowed_users is
  'Signup allowlist. Seeded from ATLAS_OWNER_EMAIL by scripts/seed-owner.ts. '
  'Consulted by the Before User Created auth hook.';

comment on column private.allowed_users.enabled is
  'Set false to revoke access without losing the record.';

-- RLS with NO policies: unreachable except by the secret key and by
-- security-definer functions. This is deliberate, not an omission.
alter table private.allowed_users enable row level security;


-- -----------------------------------------------------------------------------
-- private.job_runs — scheduled-job ledger and overlap lock
-- -----------------------------------------------------------------------------
-- The unique constraint on (job_name, run_key) is what makes duplicate cron
-- firings harmless rather than merely unlikely. A job claims its unit of work
-- before doing anything; no row returned means someone else owns it.

create table if not exists private.job_runs (
  id           uuid primary key default gen_random_uuid(),
  job_name     text not null,
  run_key      text not null,
  status       text not null default 'running',
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms  integer,
  error_code   text,
  details      jsonb not null default '{}'::jsonb,

  constraint job_runs_status_check
    check (status in ('running', 'succeeded', 'failed', 'skipped')),
  constraint job_runs_unique_work
    unique (job_name, run_key)
);

comment on table private.job_runs is
  'One row per unit of scheduled work. unique(job_name, run_key) prevents a '
  'job from processing the same unit twice, whatever cron does.';

comment on column private.job_runs.run_key is
  'Logical identity of the work, e.g. daily_briefing:2026-08-06:Asia/Singapore. '
  'Recurring reminders must include the trigger time so each occurrence is '
  'distinct.';

comment on column private.job_runs.details is
  'Diagnostics only. Never user content, never secrets.';

create index if not exists job_runs_recent_idx
  on private.job_runs (job_name, started_at desc);

alter table private.job_runs enable row level security;


-- -----------------------------------------------------------------------------
-- private.job_status — most recent run of each job
-- -----------------------------------------------------------------------------
-- Surfaced read-only in Settings -> System so a job that stopped running is
-- visible immediately rather than discovered weeks later.

create or replace view private.job_status as
select distinct on (job_name)
  job_name,
  status,
  started_at,
  completed_at,
  duration_ms,
  error_code
from private.job_runs
order by job_name, started_at desc;
