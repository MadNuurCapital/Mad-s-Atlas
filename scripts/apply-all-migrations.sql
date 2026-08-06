-- =============================================================================
-- Mad's Atlas — ALL migrations, combined into one file.
-- =============================================================================
--
-- Paste this whole file into the Supabase SQL Editor and press Run. It builds
-- the entire database in one go: 17 tables, Row Level Security on every one,
-- the triggers, and the security functions.
--
-- Safe to run more than once. Every statement is idempotent, so a second run
-- changes nothing.
--
-- This is the same content as supabase/migrations/*.sql, in the same order.
-- The Supabase CLI (`supabase db push`) is the normal route; this file exists
-- for when you would rather not install the CLI.
--
-- AFTER running this, run scripts/verify-database.sql to confirm, then seed
-- the owner allowlist — see the note at the bottom of this file.
-- =============================================================================



-- ####################################################################
-- # 20260806000001_extensions_and_private_schema.sql
-- ####################################################################

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

-- ####################################################################
-- # 20260806000002_helpers_and_auth_hook.sql
-- ####################################################################

-- =============================================================================
-- 0002 — Shared helpers and the Before User Created auth hook
-- =============================================================================
--
-- Purpose:
--   The updated_at trigger used by every mutable table, email normalisation,
--   the owner check, and the auth hook that rejects unauthorised signups.
--
-- Rollback:
--   drop function if exists private.check_user_allowed(jsonb);
--   drop function if exists public.is_owner();
--   drop function if exists private.normalise_email(text);
--   drop function if exists private.set_updated_at();
--   -- Dropping check_user_allowed re-opens signup to anyone who passes Google
--   -- OAuth. Disable the hook in the dashboard FIRST, and only if intended.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
-- Applied by trigger everywhere rather than trusted to the application. An
-- application that forgets is invisible; a trigger cannot forget.

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- Email normalisation
-- -----------------------------------------------------------------------------
-- Gmail treats dots as insignificant and everything after '+' as an alias, so
-- `m.ad+anything@gmail.com` delivers to `mad@gmail.com`. An exact string
-- comparison would let an attacker who knows the owner's address construct
-- unlimited variants that are "different" to the allowlist but identical to
-- Google. Normalising closes that.

create or replace function private.normalise_email(p_email text)
returns extensions.citext
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_local   text;
  v_domain  text;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return null;
  end if;

  -- More than one '@' means the address is malformed. Reject rather than
  -- silently taking the first or last, which would make two different inputs
  -- normalise to the same mailbox.
  if length(v_email) - length(replace(v_email, '@', '')) <> 1 then
    return null;
  end if;

  v_local  := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);

  -- BOTH halves must be present. Checking only the local part lets 'user@'
  -- through as the literal string 'user@'.
  if v_local = '' or v_domain = '' then
    return null;
  end if;

  -- Strip the +alias on every provider: it is never part of the identity.
  v_local := split_part(v_local, '+', 1);

  -- Dots are insignificant on Google-hosted addresses only.
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local  := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;

  if v_local = '' then
    return null;
  end if;

  return (v_local || '@' || v_domain)::extensions.citext;
end;
$$;

comment on function private.normalise_email(text) is
  'Lower-cases, trims, strips +aliases, and removes dots for Gmail addresses '
  'so allowlist comparison cannot be bypassed with an equivalent variant.';


-- -----------------------------------------------------------------------------
-- private.is_email_allowed
-- -----------------------------------------------------------------------------

create or replace function private.is_email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.allowed_users a
    where a.email = private.normalise_email(p_email)
      and a.enabled = true
  );
$$;


-- -----------------------------------------------------------------------------
-- public.is_owner — layer 2, callable from other security-definer functions
-- -----------------------------------------------------------------------------
-- This SUPPLEMENTS Row Level Security; it never replaces it. RLS is what makes
-- the data safe. This makes intent explicit inside functions that need it.

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and private.is_email_allowed(u.email)
  );
$$;

comment on function public.is_owner() is
  'True when the current session belongs to an enabled allowlisted user. '
  'Supplements RLS — never a substitute for it.';

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;


-- -----------------------------------------------------------------------------
-- private.check_user_allowed — the Before User Created hook
-- -----------------------------------------------------------------------------
-- Wire this up at: Dashboard -> Authentication -> Hooks -> Before User Created
--   Type:     Postgres function
--   Function: private.check_user_allowed
--
-- Returning an object with an `error` key rejects the signup. Returning an
-- empty object allows it. This runs BEFORE a row is created in auth.users, so
-- an unauthorised account never exists even momentarily.

create or replace function private.check_user_allowed(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  -- The email arrives in different places depending on the flow, so check
  -- each known location rather than assuming one shape.
  v_email := coalesce(
    event -> 'user_metadata' ->> 'email',
    event -> 'claims' ->> 'email',
    event #>> '{user,email}',
    event ->> 'email'
  );

  if not private.is_email_allowed(v_email) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        -- Deliberately uninformative: a stranger learns nothing about who IS
        -- allowed, and no email address is echoed back to them.
        'message', 'This application is private.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

comment on function private.check_user_allowed(jsonb) is
  'Before User Created auth hook. Rejects any signup whose email is not an '
  'enabled row in private.allowed_users.';

grant execute on function private.check_user_allowed(jsonb) to supabase_auth_admin;
revoke execute on function private.check_user_allowed(jsonb)
  from authenticated, anon, public;

-- The hook runs as supabase_auth_admin and must be able to read the allowlist.
grant usage on schema private to supabase_auth_admin;
grant select on private.allowed_users to supabase_auth_admin;

-- ####################################################################
-- # 20260806000003_profiles_and_settings.sql
-- ####################################################################

-- =============================================================================
-- 0003 — Profiles and user settings
-- =============================================================================
--
-- Purpose:
--   Identity and preferences, created automatically when a user is first
--   inserted so the application never has to cope with a half-provisioned
--   account.
--
-- Rollback:
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists private.handle_new_user();
--   drop table if exists public.user_settings;
--   drop table if exists public.profiles;
--   -- Destroys profile and preference data.
--
-- =============================================================================

create table if not exists public.profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references auth.users(id) on delete cascade,
  email            extensions.citext not null,
  display_name     text,
  preferred_name   text,
  timezone         text not null default 'Asia/Singapore',
  locale           text not null default 'en-SG',
  default_voice    text,
  briefing_time    time not null default '09:00',
  briefing_enabled boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.profiles is 'One row per user. Identity and briefing preferences.';
comment on column public.profiles.timezone is
  'IANA name. Asia/Singapore is a fixed UTC+08:00 with no daylight saving.';
comment on column public.profiles.preferred_name is
  'What Atlas calls him in conversation.';
comment on column public.profiles.briefing_time is
  'Local to `timezone`. 09:00 Singapore is 01:00 UTC.';

create index if not exists profiles_user_idx on public.profiles (user_id);


create table if not exists public.user_settings (
  id                           uuid primary key default gen_random_uuid(),
  user_id                      uuid not null unique references auth.users(id) on delete cascade,
  memory_enabled               boolean not null default true,
  proactive_briefings_enabled  boolean not null default true,
  email_summary_enabled        boolean not null default true,
  calendar_preparation_enabled boolean not null default true,
  -- Off by default: notifications need an explicit browser permission, and a
  -- setting that is on but silently does nothing would be dishonest.
  notification_enabled         boolean not null default false,
  conversation_retention_days  integer not null default 30,
  research_detail_level        text not null default 'standard',
  approval_expiry_minutes      integer not null default 60,
  meeting_prep_lead_minutes    integer not null default 30,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint user_settings_retention_check
    check (conversation_retention_days between 1 and 365),
  constraint user_settings_detail_check
    check (research_detail_level in ('brief', 'standard', 'detailed')),
  constraint user_settings_approval_expiry_check
    check (approval_expiry_minutes between 5 and 1440),
  constraint user_settings_meeting_prep_check
    check (meeting_prep_lead_minutes between 5 and 240)
);

comment on table public.user_settings is 'Feature toggles, retention windows and thresholds.';
comment on column public.user_settings.notification_enabled is
  'Off by default. Requires an explicit browser permission grant first.';


-- -----------------------------------------------------------------------------
-- Provisioning
-- -----------------------------------------------------------------------------
-- Runs on user creation so a profile and settings row always exist. Failure
-- here must never block account creation, hence the exception guard: a missing
-- profile is recoverable, a broken signup is not.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
exception
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();


drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function private.set_updated_at();

drop trigger if exists allowed_users_set_updated_at on private.allowed_users;
create trigger allowed_users_set_updated_at
  before update on private.allowed_users
  for each row execute function private.set_updated_at();

-- ####################################################################
-- # 20260806000004_connected_accounts.sql
-- ####################################################################

-- =============================================================================
-- 0004 — Connected accounts (encrypted Google tokens)
-- =============================================================================
--
-- Purpose:
--   Store Google OAuth tokens encrypted with AES-256-GCM, and make the single
--   most dangerous mistake in this system structurally impossible: silently
--   destroying a valid refresh token.
--
-- Rollback:
--   drop view if exists public.connected_account_status;
--   drop trigger if exists connected_accounts_protect_refresh_token
--     on public.connected_accounts;
--   drop function if exists private.protect_refresh_token();
--   drop table if exists public.connected_accounts;
--   -- Destroys stored tokens. Muhammad must reconnect Google afterwards.
--
-- =============================================================================

create table if not exists public.connected_accounts (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  provider                    text not null default 'google',
  provider_account_id         text not null,
  email                       extensions.citext not null,
  granted_scopes              text[] not null default '{}',

  encrypted_access_token      bytea,
  encrypted_refresh_token     bytea,
  token_initialisation_vector bytea,
  token_authentication_tag    bytea,

  access_token_expires_at     timestamptz,
  connection_status           text not null default 'connected',
  last_refreshed_at           timestamptz,
  last_error                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint connected_accounts_unique
    unique (user_id, provider, provider_account_id),
  constraint connected_accounts_status_check
    check (connection_status in ('connected', 'needs_reconnection', 'revoked', 'error')),
  constraint connected_accounts_provider_check
    check (provider in ('google'))
);

comment on table public.connected_accounts is
  'Google OAuth tokens, encrypted at rest. Token columns are readable only by '
  'the service role. Clients read public.connected_account_status instead.';

comment on column public.connected_accounts.encrypted_access_token is
  'ENCRYPTED (AES-256-GCM). Decryptable only in trusted server environments. '
  'Never expose to any client.';
comment on column public.connected_accounts.encrypted_refresh_token is
  'ENCRYPTED (AES-256-GCM). Never expose to any client. Never overwrite with '
  'NULL — Google omits the refresh token on most re-consents, and losing it '
  'breaks every scheduled job. Enforced by trigger below.';
comment on column public.connected_accounts.token_initialisation_vector is
  'AES-GCM IV. Unique per encryption operation. Not secret, but required to '
  'decrypt.';
comment on column public.connected_accounts.token_authentication_tag is
  'AES-GCM authentication tag. A mismatch means the ciphertext was tampered '
  'with and decryption must fail.';
comment on column public.connected_accounts.granted_scopes is
  'What consent ACTUALLY returned, which can be narrower than what was '
  'requested. Check this before assuming an API call will succeed.';
comment on column public.connected_accounts.last_error is
  'Redacted message only. Never a token, never a raw provider payload.';

create index if not exists connected_accounts_user_idx
  on public.connected_accounts (user_id, provider);

create index if not exists connected_accounts_status_idx
  on public.connected_accounts (connection_status)
  where connection_status <> 'connected';


-- -----------------------------------------------------------------------------
-- The refresh-token guard
-- -----------------------------------------------------------------------------
-- Google returns a refresh token on first consent and usually NOT afterwards.
-- Application code that blindly writes whatever the callback returned will
-- therefore null a perfectly good token on the second login — and nothing
-- appears broken until the next unattended cron run, days later.
--
-- The application also guards this. The trigger exists because application
-- guards can be refactored away by someone who does not know why they were
-- there, and this failure is silent, delayed and expensive.

create or replace function private.protect_refresh_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.encrypted_refresh_token is not null
     and new.encrypted_refresh_token is null then
    raise exception
      'Refusing to erase a valid Google refresh token (account %). Google '
      'omits the refresh token on most re-consents; preserve the stored value '
      'instead of writing NULL.', old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists connected_accounts_protect_refresh_token
  on public.connected_accounts;
create trigger connected_accounts_protect_refresh_token
  before update on public.connected_accounts
  for each row execute function private.protect_refresh_token();

drop trigger if exists connected_accounts_set_updated_at on public.connected_accounts;
create trigger connected_accounts_set_updated_at
  before update on public.connected_accounts
  for each row execute function private.set_updated_at();


-- -----------------------------------------------------------------------------
-- Client-facing view — no token columns exist here to leak
-- -----------------------------------------------------------------------------
-- security_invoker = true is essential. Without it the view runs as its owner
-- and silently bypasses the RLS policy on the underlying table.

create or replace view public.connected_account_status
with (security_invoker = true) as
select
  id,
  user_id,
  provider,
  email,
  granted_scopes,
  connection_status,
  access_token_expires_at,
  last_refreshed_at,
  created_at,
  updated_at
from public.connected_accounts;

comment on view public.connected_account_status is
  'Safe projection of connected_accounts for client use. Contains no token '
  'columns, so there is nothing sensitive to expose.';

-- ####################################################################
-- # 20260806000005_memories.sql
-- ####################################################################

-- =============================================================================
-- 0005 — Memory and memory versions
-- =============================================================================
--
-- Purpose:
--   Curated personal memory with full-text and semantic search, and a
--   recoverable version history.
--
-- Rollback:
--   drop trigger if exists memories_version_on_update on public.memories;
--   drop function if exists private.record_memory_version();
--   drop table if exists public.memory_versions;
--   drop table if exists public.memories;
--   -- Destroys all remembered information and its history.
--
-- =============================================================================

create table if not exists public.memories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  content         text not null,
  category        text not null,
  structured_data jsonb not null default '{}'::jsonb,
  status          text not null default 'suggested',
  confidence      numeric(3,2) not null default 0.50,
  sensitivity     text not null default 'normal',
  source_type     text not null default 'manual',
  source_reference text,

  confirmed_at      timestamptz,
  last_confirmed_at timestamptz,
  expires_at        timestamptz,
  superseded_by     uuid references public.memories(id) on delete set null,

  -- 1536, not the model's default 3072: pgvector cannot build an HNSW or
  -- IVFFlat index on a vector wider than 2000 dimensions, and an unindexed
  -- column means a sequential scan on every semantic search. Matryoshka
  -- truncation keeps the quality and keeps the index.
  embedding      extensions.vector(1536),
  embedding_attempts integer not null default 0,

  search_vector  tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint memories_category_check check (category in (
    'profile', 'preference', 'goal', 'routine', 'important_person',
    'project', 'commitment', 'decision', 'idea_reference', 'temporary_context'
  )),
  constraint memories_status_check check (status in (
    'suggested', 'confirmed', 'superseded', 'expired', 'deleted'
  )),
  constraint memories_sensitivity_check check (sensitivity in (
    'normal', 'personal', 'sensitive', 'highly_sensitive'
  )),
  constraint memories_source_check check (source_type in (
    'voice', 'text', 'email', 'calendar', 'research', 'manual', 'system'
  )),
  constraint memories_confidence_check check (confidence >= 0 and confidence <= 1),
  -- temporary_context without an expiry is not temporary.
  constraint memories_temporary_needs_expiry check (
    category <> 'temporary_context' or expires_at is not null
  ),
  constraint memories_confirmed_has_timestamp check (
    status <> 'confirmed' or confirmed_at is not null
  )
);

comment on table public.memories is
  'Curated personal memory. Only status = ''confirmed'' rows inform answers; '
  'suggestions are shown for review and never treated as fact.';
comment on column public.memories.embedding is
  'vector(1536) via Matryoshka truncation of gemini-embedding-001. Nullable: '
  'generated asynchronously, and a failed embedding must never block a save.';
comment on column public.memories.embedding_attempts is
  'Backfill retry counter. Bounded so a permanently failing row is flagged '
  'rather than retried forever.';
comment on column public.memories.sensitivity is
  'highly_sensitive rows are excluded from proactive output and from prompts '
  'unless the request directly concerns them.';
comment on column public.memories.superseded_by is
  'Points at the memory that replaced this one. Both rows are retained.';

-- Full-text
create index if not exists memories_search_idx
  on public.memories using gin (search_vector);

-- Semantic. Partial: only confirmed, live rows are ever searched this way,
-- which keeps the index small and the recall honest.
create index if not exists memories_embedding_idx
  on public.memories using hnsw (embedding extensions.vector_cosine_ops)
  where deleted_at is null and status = 'confirmed';

create index if not exists memories_lookup_idx
  on public.memories (user_id, status, category)
  where deleted_at is null;

create index if not exists memories_expiry_idx
  on public.memories (expires_at)
  where expires_at is not null and deleted_at is null and status <> 'expired';

-- Backfill queue for the embedding job.
create index if not exists memories_pending_embedding_idx
  on public.memories (user_id, created_at)
  where embedding is null and deleted_at is null and embedding_attempts < 5;

create index if not exists memories_suggested_idx
  on public.memories (user_id, created_at desc)
  where status = 'suggested' and deleted_at is null;


-- -----------------------------------------------------------------------------
-- Version history
-- -----------------------------------------------------------------------------

create table if not exists public.memory_versions (
  id                       uuid primary key default gen_random_uuid(),
  memory_id                uuid not null references public.memories(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  previous_content         text not null,
  previous_structured_data jsonb not null default '{}'::jsonb,
  change_reason            text,
  changed_by               text not null default 'user',
  created_at               timestamptz not null default now(),

  constraint memory_versions_changed_by_check check (changed_by in ('user', 'atlas'))
);

comment on table public.memory_versions is
  'Prior content of every edited memory. Written by trigger, never by the '
  'application, so an edit cannot skip the audit trail.';

create index if not exists memory_versions_memory_idx
  on public.memory_versions (memory_id, created_at desc);


create or replace function private.record_memory_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only record when the substance changed. Status transitions and embedding
  -- backfills would otherwise flood the history with noise.
  if old.content is distinct from new.content
     or old.structured_data is distinct from new.structured_data then
    insert into public.memory_versions (
      memory_id, user_id, previous_content, previous_structured_data,
      change_reason, changed_by
    )
    values (
      old.id, old.user_id, old.content, old.structured_data,
      case
        when new.status = 'superseded' then 'superseded'
        when new.deleted_at is not null then 'deleted'
        else 'edited'
      end,
      'user'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists memories_version_on_update on public.memories;
create trigger memories_version_on_update
  before update on public.memories
  for each row execute function private.record_memory_version();

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at
  before update on public.memories
  for each row execute function private.set_updated_at();

-- ####################################################################
-- # 20260806000006_tasks_reminders_ideas.sql
-- ####################################################################

-- =============================================================================
-- 0006 — Tasks, reminders and ideas
-- =============================================================================
--
-- Rollback:
--   drop table if exists public.reminders;
--   drop table if exists public.ideas;
--   drop table if exists public.tasks;
--   -- Destroys all captured tasks, reminders and ideas.
--
-- =============================================================================

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  status      text not null default 'inbox',
  priority    text not null default 'normal',
  due_at      timestamptz,
  start_at    timestamptz,
  completed_at timestamptz,
  source      text not null default 'manual',
  -- Free text: a personal label such as "Mad's Atlas". Deliberately NOT a
  -- foreign key to anything — this application has no path to any external
  -- project system, and adding one would be a product boundary violation.
  related_project text,
  recurrence_rule text,
  google_calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint tasks_status_check check (status in (
    'inbox', 'planned', 'in_progress', 'waiting', 'completed', 'cancelled'
  )),
  constraint tasks_priority_check check (priority in (
    'low', 'normal', 'high', 'critical'
  )),
  constraint tasks_source_check check (source in (
    'manual', 'voice', 'email', 'briefing', 'idea'
  )),
  -- Keeps status and completed_at from disagreeing about reality.
  constraint tasks_completed_consistency check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

comment on table public.tasks is 'Personal tasks. Stored here, never in an external system.';
comment on column public.tasks.related_project is
  'Free-text personal label. Not a reference to any external project database.';
comment on column public.tasks.google_calendar_event_id is
  'Set only when the task was mirrored to Google Calendar with approval.';

create index if not exists tasks_open_idx
  on public.tasks (user_id, due_at)
  where deleted_at is null and status not in ('completed', 'cancelled');

create index if not exists tasks_status_idx
  on public.tasks (user_id, status, due_at)
  where deleted_at is null;

create index if not exists tasks_priority_idx
  on public.tasks (user_id, priority, due_at)
  where deleted_at is null and status not in ('completed', 'cancelled');


create table if not exists public.reminders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  description     text,
  remind_at       timestamptz not null,
  recurrence_rule text,
  -- Recurrence must expand in the reminder's own zone, not the server's:
  -- "every weekday at 9am" means 9am where he is.
  timezone        text not null default 'Asia/Singapore',
  delivery_channel text not null default 'push',
  status          text not null default 'scheduled',
  related_task_id uuid references public.tasks(id) on delete set null,
  google_calendar_event_id text,
  last_triggered_at timestamptz,
  next_trigger_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint reminders_status_check check (status in (
    'scheduled', 'triggered', 'acknowledged', 'disabled', 'completed'
  )),
  constraint reminders_channel_check check (delivery_channel in (
    'push', 'in_app', 'calendar'
  ))
);

comment on column public.reminders.timezone is
  'Recurrence expands in THIS zone, not the server''s.';
comment on column public.reminders.next_trigger_at is
  'Next occurrence for recurring reminders. The cron job scans only this.';

-- The reminder job's only lookup. Narrow on purpose: it runs every 5 minutes.
create index if not exists reminders_due_idx
  on public.reminders (next_trigger_at)
  where status = 'scheduled';

create index if not exists reminders_user_idx
  on public.reminders (user_id, remind_at desc);


create table if not exists public.ideas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null,
  -- Never rewritten. The exact words matter; a summary is stored separately.
  original_capture text not null,
  summary          text,
  category         text,
  status           text not null default 'captured',
  next_action      text,
  structured_plan  jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,

  constraint ideas_status_check check (status in (
    'captured', 'exploring', 'planned', 'building', 'completed', 'parked', 'archived'
  ))
);

comment on column public.ideas.original_capture is
  'Preserved verbatim. Atlas may summarise it, never overwrite it.';
comment on column public.ideas.structured_plan is
  'Generated plan, including any Claude Code brief.';

create index if not exists ideas_status_idx
  on public.ideas (user_id, status, updated_at desc)
  where archived_at is null;


drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at before update on public.reminders
  for each row execute function private.set_updated_at();

drop trigger if exists ideas_set_updated_at on public.ideas;
create trigger ideas_set_updated_at before update on public.ideas
  for each row execute function private.set_updated_at();

-- ####################################################################
-- # 20260806000007_approvals_and_logs.sql
-- ####################################################################

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

-- ####################################################################
-- # 20260806000008_conversations_research_briefings.sql
-- ####################################################################

-- =============================================================================
-- 0008 — Conversations, research and daily briefings
-- =============================================================================
--
-- Rollback:
--   drop table if exists public.notification_subscriptions;
--   drop table if exists public.daily_briefings;
--   drop table if exists public.research_sources;
--   drop table if exists public.research_reports;
--   drop table if exists public.conversation_messages;
--   drop table if exists public.conversations;
--
-- =============================================================================

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text,
  channel    text not null default 'text',
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  -- The summary outlives the messages: continuity without indefinite retention.
  summary    text,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint conversations_channel_check check (channel in (
    'voice', 'text', 'system', 'scheduled'
  ))
);

comment on table public.conversations is
  'Conversation metadata and summary. Raw voice audio is NEVER stored, and '
  'voice transcripts are session-only unless explicitly saved.';


create table if not exists public.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- Denormalised so RLS needs no join on the hottest table here.
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null,
  content         text not null,
  tool_call_metadata jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  -- Set at write time from user_settings.conversation_retention_days so the
  -- cleanup job scans one index and never has to join.
  retention_until timestamptz not null,

  constraint conversation_messages_role_check check (role in (
    'user', 'assistant', 'system', 'tool'
  ))
);

comment on column public.conversation_messages.retention_until is
  'Set at write time. The retention job deletes rows past this and nothing else.';

create index if not exists conversation_messages_retention_idx
  on public.conversation_messages (retention_until);
create index if not exists conversation_messages_thread_idx
  on public.conversation_messages (conversation_id, created_at);


create table if not exists public.research_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  query      text not null,
  summary    text not null,
  why_it_matters text,
  structured_result jsonb not null default '{}'::jsonb,
  searched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on column public.research_reports.structured_result is
  'Key findings, practical implications, uncertainty and any conflicting '
  'information.';
comment on column public.research_reports.searched_at is
  'When the search actually ran — not when the row was written. A report read '
  'tomorrow must show how old its evidence is.';


create table if not exists public.research_sources (
  id         uuid primary key default gen_random_uuid(),
  research_report_id uuid not null references public.research_reports(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  publisher  text,
  source_url text not null,
  -- NULL when genuinely unknown. Never guessed: a fabricated date is worse
  -- than an absent one.
  publication_date date,
  accessed_at timestamptz not null default now(),
  relevance_score numeric(3,2),
  created_at timestamptz not null default now(),

  constraint research_sources_relevance_check
    check (relevance_score is null or (relevance_score >= 0 and relevance_score <= 1)),
  constraint research_sources_url_scheme_check
    check (source_url ~* '^https?://')
);

comment on table public.research_sources is
  'Real sources from grounding metadata. Citations are never constructed by '
  'the model. A report with no sources cannot be presented as verified.';
comment on column public.research_sources.publication_date is
  'NULL when unknown. Never inferred.';

create index if not exists research_sources_report_idx
  on public.research_sources (research_report_id);


create table if not exists public.daily_briefings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  briefing_date date not null,
  timezone      text not null default 'Asia/Singapore',
  calendar_summary   jsonb not null default '{}'::jsonb,
  email_summary      jsonb not null default '{}'::jsonb,
  task_summary       jsonb not null default '{}'::jsonb,
  market_summary     jsonb not null default '{}'::jsonb,
  technology_summary jsonb not null default '{}'::jsonb,
  recommended_priority text,
  full_briefing text,
  generated_at  timestamptz,
  delivered_at  timestamptz,
  status        text not null default 'generating',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint daily_briefings_status_check check (status in (
    'generating', 'ready', 'delivered', 'failed'
  )),
  -- The independent backstop against duplicate briefings. The job lock in
  -- private.job_runs is the first guard; this one holds even if that fails.
  constraint daily_briefings_one_per_day unique (user_id, briefing_date, timezone)
);

comment on constraint daily_briefings_one_per_day on public.daily_briefings is
  'Independent of the job lock. Two guards, because a duplicate briefing is '
  'the failure most likely to go unnoticed.';
comment on column public.daily_briefings.briefing_date is
  'LOCAL date in `timezone`, not the UTC date. 17:00 UTC is already tomorrow '
  'in Singapore.';


create table if not exists public.notification_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth_secret text not null,
  user_agent text,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_subscriptions_unique unique (user_id, endpoint)
);

comment on column public.notification_subscriptions.p256dh is
  'Subscription public key. Treated as a credential: never returned to a '
  'client, never logged.';
comment on column public.notification_subscriptions.auth_secret is
  'Subscription auth secret. Treated as a credential: never returned to a '
  'client, never logged.';

-- Safe projection: lets the UI list and manage devices without ever handing
-- the push credentials back to the browser that would then hold them.
create or replace view public.notification_subscription_status
with (security_invoker = true) as
select id, user_id, user_agent, enabled, created_at, updated_at
from public.notification_subscriptions;


drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

drop trigger if exists daily_briefings_set_updated_at on public.daily_briefings;
create trigger daily_briefings_set_updated_at before update on public.daily_briefings
  for each row execute function private.set_updated_at();

drop trigger if exists notification_subscriptions_set_updated_at
  on public.notification_subscriptions;
create trigger notification_subscriptions_set_updated_at
  before update on public.notification_subscriptions
  for each row execute function private.set_updated_at();

-- ####################################################################
-- # 20260806000009_row_level_security.sql
-- ####################################################################

-- =============================================================================
-- 0009 — Row Level Security
-- =============================================================================
--
-- Purpose:
--   Enable RLS on every table in `public` and restrict every row to its owner.
--
-- This holds even though there is exactly one user. Writing it securely now
-- costs nothing; retrofitting it onto populated tables is how gaps survive.
--
-- Rules, without exception:
--   * No policy grants `anon`.
--   * No policy uses `true` as its predicate.
--   * No blanket grant to `authenticated`.
--   * Tables written only by server code get NO insert policy — those writes
--     use the secret key, which bypasses RLS by design. That is precisely why
--     the secret key must never reach the browser.
--
-- Rollback:
--   Dropping policies WEAKENS security. Do not do it to "fix" a query — a
--   query that needs a dropped policy is querying with the wrong client.
--
-- =============================================================================

alter table public.profiles                  enable row level security;
alter table public.user_settings             enable row level security;
alter table public.connected_accounts        enable row level security;
alter table public.memories                  enable row level security;
alter table public.memory_versions           enable row level security;
alter table public.tasks                     enable row level security;
alter table public.reminders                 enable row level security;
alter table public.ideas                     enable row level security;
alter table public.approvals                 enable row level security;
alter table public.action_logs               enable row level security;
alter table public.tool_runs                 enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_messages     enable row level security;
alter table public.research_reports          enable row level security;
alter table public.research_sources          enable row level security;
alter table public.daily_briefings           enable row level security;
alter table public.notification_subscriptions enable row level security;


-- -----------------------------------------------------------------------------
-- Full ownership: select / insert / update / delete
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'memories', 'tasks', 'reminders', 'ideas', 'conversations'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated
         using (auth.uid() = user_id)', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (auth.uid() = user_id)', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (auth.uid() = user_id)', t || '_delete_own', t);
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- profiles / user_settings — own row, but never deletable directly
-- -----------------------------------------------------------------------------
-- Deletion happens through delete_all_user_data() or account removal, so the
-- two rows cannot be orphaned by a stray DELETE.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- connected_accounts — NO client select policy at all
-- -----------------------------------------------------------------------------
-- The token columns live on this table, so clients get no read access to it.
-- They read public.connected_account_status instead, which has no token
-- columns to leak. Disconnecting is a delete the user may perform.

drop policy if exists connected_accounts_delete_own on public.connected_accounts;
create policy connected_accounts_delete_own on public.connected_accounts
  for delete to authenticated using (auth.uid() = user_id);

-- The view is security_invoker, so it needs a select policy on the base table
-- to work. Scoped to the owner and, critically, the VIEW is what clients are
-- granted on — see the grants at the end of this file.
drop policy if exists connected_accounts_select_own on public.connected_accounts;
create policy connected_accounts_select_own on public.connected_accounts
  for select to authenticated using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- Read-only to the client; written by server code with the secret key
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'memory_versions', 'action_logs', 'tool_runs', 'research_reports',
    'research_sources', 'daily_briefings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (auth.uid() = user_id)', t || '_select_own', t);
  end loop;
end
$$;

-- Research and briefings may be deleted by their owner (data rights).
drop policy if exists research_reports_delete_own on public.research_reports;
create policy research_reports_delete_own on public.research_reports
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists daily_briefings_delete_own on public.daily_briefings;
create policy daily_briefings_delete_own on public.daily_briefings
  for delete to authenticated using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- approvals — select and update only
-- -----------------------------------------------------------------------------
-- No client INSERT: approvals are created by the orchestrator, so a client
-- cannot fabricate one for an action Atlas never proposed.
-- No client DELETE: the record of what was proposed is part of the audit trail.
--
-- The UPDATE policy allows recording a decision. It does NOT allow executing:
-- the transition to 'executed' happens only inside claim_approval(), and the
-- WITH CHECK below refuses any client-side attempt to set that status.

drop policy if exists approvals_select_own on public.approvals;
create policy approvals_select_own on public.approvals
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists approvals_decide_own on public.approvals;
create policy approvals_decide_own on public.approvals
  for update to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status in ('approved', 'rejected'));

comment on policy approvals_decide_own on public.approvals is
  'Lets the owner approve or reject a PENDING approval. Cannot set '
  '''executed'' — only claim_approval() can, atomically.';


-- -----------------------------------------------------------------------------
-- conversation_messages — immutable once written
-- -----------------------------------------------------------------------------

drop policy if exists conversation_messages_select_own on public.conversation_messages;
create policy conversation_messages_select_own on public.conversation_messages
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists conversation_messages_insert_own on public.conversation_messages;
create policy conversation_messages_insert_own on public.conversation_messages
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists conversation_messages_delete_own on public.conversation_messages;
create policy conversation_messages_delete_own on public.conversation_messages
  for delete to authenticated using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- notification_subscriptions
-- -----------------------------------------------------------------------------

drop policy if exists notification_subscriptions_select_own on public.notification_subscriptions;
create policy notification_subscriptions_select_own on public.notification_subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists notification_subscriptions_insert_own on public.notification_subscriptions;
create policy notification_subscriptions_insert_own on public.notification_subscriptions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists notification_subscriptions_update_own on public.notification_subscriptions;
create policy notification_subscriptions_update_own on public.notification_subscriptions
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists notification_subscriptions_delete_own on public.notification_subscriptions;
create policy notification_subscriptions_delete_own on public.notification_subscriptions
  for delete to authenticated using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- Table-level grants
-- -----------------------------------------------------------------------------
-- RLS filters rows, but a role still needs a GRANT to touch the table at all.
-- Supabase happens to grant these to `authenticated` by default, so omitting
-- them appears to work there and fails everywhere else — and inheriting access
-- control from a platform default is not something worth depending on. These
-- grants mirror the policy matrix in DATABASE_SCHEMA.md exactly.

-- Full CRUD.
grant select, insert, update, delete on
  public.memories, public.tasks, public.reminders, public.ideas,
  public.conversations
  to authenticated;

-- Own row, but deletion goes through delete_all_user_data() only.
grant select, insert, update on public.profiles, public.user_settings
  to authenticated;

-- Append-only from the client's perspective; written server-side.
grant select on
  public.memory_versions, public.action_logs, public.tool_runs,
  public.research_sources
  to authenticated;

-- Readable, and deletable as a data right.
grant select, delete on public.research_reports, public.daily_briefings
  to authenticated;

-- Approvals: no INSERT (the orchestrator creates them, so a client cannot
-- fabricate one) and no DELETE (the record is part of the audit trail).
-- UPDATE is constrained further by the approvals_decide_own policy.
grant select, update on public.approvals to authenticated;

-- Messages are immutable once written.
grant select, insert, delete on public.conversation_messages to authenticated;

-- Views the client reads instead of the sensitive base tables.
grant select on public.connected_account_status to authenticated;
grant select on public.notification_subscription_status to authenticated;


-- -----------------------------------------------------------------------------
-- Column-level grants
-- -----------------------------------------------------------------------------
-- RLS decides WHICH ROWS. These grants decide WHICH COLUMNS. Revoking the
-- token columns means that even a policy mistake cannot expose them: there is
-- no grant under which a client may select them.

revoke all on public.connected_accounts from anon, authenticated;
grant select (
  id, user_id, provider, provider_account_id, email, granted_scopes,
  connection_status, access_token_expires_at, last_refreshed_at,
  created_at, updated_at
) on public.connected_accounts to authenticated;
grant delete on public.connected_accounts to authenticated;

revoke all on public.notification_subscriptions from anon, authenticated;
grant select (id, user_id, endpoint, user_agent, enabled, created_at, updated_at)
  on public.notification_subscriptions to authenticated;
grant insert, update, delete on public.notification_subscriptions to authenticated;

-- Nothing in public is reachable anonymously.
revoke all on all tables in schema public from anon;

-- ####################################################################
-- # 20260806000010_functions.sql
-- ####################################################################

-- =============================================================================
-- 0010 — Database functions
-- =============================================================================
--
-- Every function here is `security definer` and therefore runs with elevated
-- privileges. Each one accordingly:
--
--   * sets search_path = '' and fully qualifies every identifier, so it cannot
--     be hijacked by a shadowing object in a user-controlled schema;
--   * validates auth.uid() and scopes results to the caller;
--   * returns only the columns needed;
--   * contains NO dynamic SQL.
--
-- Rollback: drop the individual functions. claim_approval() is load-bearing —
-- without it there is no atomic guard against double execution.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- claim_approval — the heart of the safety model
-- -----------------------------------------------------------------------------
-- A single UPDATE ... RETURNING is the claim. Status, ownership, idempotency
-- key and expiry are all checked inside that one statement, so there is no
-- window between checking and acting for a second caller to slip through.
--
-- A concurrent second call finds status already 'executed' and raises. This is
-- why a double click, a retry storm or a replayed request cannot execute an
-- action twice — not because the UI disables a button.

create or replace function public.claim_approval(
  p_approval_id uuid,
  p_idempotency_key text
)
returns public.approvals
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
     set status      = 'executed',
         executed_at = now(),
         updated_at  = now()
   where id = p_approval_id
     and user_id = auth.uid()
     and status = 'approved'
     and idempotency_key = p_idempotency_key
     and expires_at > now()
  returning * into v_row;

  if not found then
    -- Deliberately one error for every failure mode. Distinguishing "already
    -- executed" from "expired" would tell a replaying caller which of its
    -- attempts landed.
    raise exception 'approval_not_claimable' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

comment on function public.claim_approval(uuid, text) is
  'Atomically transitions an approval from approved to executed. Returns the '
  'claimed row, or raises approval_not_claimable. An approval can be claimed '
  'at most once, only while approved and unexpired.';

revoke all on function public.claim_approval(uuid, text) from public, anon;
grant execute on function public.claim_approval(uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
-- Memory search
-- -----------------------------------------------------------------------------

create or replace function public.search_memories_semantic(
  p_embedding extensions.vector(1536),
  p_limit integer default 12,
  p_min_similarity numeric default 0.55
)
returns table (
  id uuid, title text, content text, category text,
  sensitivity text, confidence numeric, similarity numeric,
  confirmed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id, m.title, m.content, m.category,
    m.sensitivity, m.confidence,
    (1 - (m.embedding OPERATOR(extensions.<=>) p_embedding))::numeric as similarity,
    m.confirmed_at
  from public.memories m
  where m.user_id = auth.uid()
    and m.deleted_at is null
    and m.status = 'confirmed'
    and m.embedding is not null
    and (m.expires_at is null or m.expires_at > now())
    and (1 - (m.embedding OPERATOR(extensions.<=>) p_embedding)) >= p_min_similarity
  order by m.embedding OPERATOR(extensions.<=>) p_embedding
  limit least(greatest(p_limit, 1), 50);
$$;

comment on function public.search_memories_semantic is
  'Cosine similarity over confirmed, live memories. Results below the '
  'similarity floor are dropped: a weak match fills the context window with '
  'noise and invites a confidently wrong answer.';


-- Hybrid retrieval. Weights are declared once here rather than scattered
-- across the application, so they can be tuned against evidence.
--   0.35 vector · 0.25 text · 0.15 recency · 0.10 confidence
--   0.10 category · 0.05 confirmation recency
create or replace function public.search_memories_hybrid(
  p_query text,
  p_embedding extensions.vector(1536) default null,
  p_categories text[] default null,
  p_limit integer default 12,
  p_include_sensitive boolean default false
)
returns table (
  id uuid, title text, content text, category text,
  sensitivity text, confidence numeric, score numeric,
  vector_similarity numeric, text_rank numeric,
  confirmed_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with scored as (
    select
      m.id, m.title, m.content, m.category, m.sensitivity,
      m.confidence, m.confirmed_at, m.last_confirmed_at, m.updated_at,
      case
        when p_embedding is null or m.embedding is null then 0::numeric
        else (1 - (m.embedding OPERATOR(extensions.<=>) p_embedding))::numeric
      end as vector_similarity,
      case
        when coalesce(trim(p_query), '') = '' then 0::numeric
        else ts_rank(m.search_vector, websearch_to_tsquery('english', p_query))::numeric
      end as text_rank,
      -- Exponential decay, ~90 day half-life.
      exp(-extract(epoch from (now() - m.updated_at)) / 7776000.0)::numeric
        as recency_decay,
      case
        when p_categories is null then 0::numeric
        when m.category = any(p_categories) then 1::numeric
        else 0::numeric
      end as category_match,
      case
        when m.last_confirmed_at is null then 0::numeric
        else exp(-extract(epoch from (now() - m.last_confirmed_at)) / 7776000.0)::numeric
      end as confirmation_recency
    from public.memories m
    where m.user_id = auth.uid()
      and m.deleted_at is null
      and m.status = 'confirmed'
      and (m.expires_at is null or m.expires_at > now())
      and (p_categories is null or m.category = any(p_categories))
      -- highly_sensitive is withheld unless the request directly concerns it.
      and (p_include_sensitive or m.sensitivity <> 'highly_sensitive')
  )
  select
    s.id, s.title, s.content, s.category, s.sensitivity, s.confidence,
    round(
      0.35 * s.vector_similarity +
      0.25 * least(s.text_rank * 10, 1) +
      0.15 * s.recency_decay +
      0.10 * s.confidence +
      0.10 * s.category_match +
      0.05 * s.confirmation_recency
    , 4) as score,
    round(s.vector_similarity, 4) as vector_similarity,
    round(s.text_rank, 4) as text_rank,
    s.confirmed_at, s.updated_at
  from scored s
  where s.vector_similarity > 0 or s.text_rank > 0 or p_categories is not null
  order by score desc
  limit least(greatest(p_limit, 1), 50);
$$;

comment on function public.search_memories_hybrid is
  'Weighted blend of vector similarity, full-text rank, recency, confidence, '
  'category relevance and confirmation recency. Ranking happens in the '
  'database so rows are not pulled out merely to be sorted.';


-- -----------------------------------------------------------------------------
-- Agenda and task retrieval
-- -----------------------------------------------------------------------------

create or replace function public.get_overdue_tasks(p_limit integer default 50)
returns table (
  id uuid, title text, priority text, due_at timestamptz, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, t.priority, t.due_at, t.status
  from public.tasks t
  where t.user_id = auth.uid()
    and t.deleted_at is null
    and t.status not in ('completed', 'cancelled')
    and t.due_at is not null
    and t.due_at < now()
  order by t.due_at asc
  limit least(greatest(p_limit, 1), 200);
$$;


create or replace function public.get_today_agenda(p_timezone text default 'Asia/Singapore')
returns table (
  kind text, id uuid, title text, at_time timestamptz, priority text, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Day boundaries are computed in the caller's zone, not UTC: in Singapore
  -- "today" starts at 16:00 UTC the previous day.
  -- The parentheses around the addition are load-bearing: `at time zone` binds
  -- more tightly than `+`, so `x + interval '1 day' at time zone tz` parses as
  -- `x + (interval '1 day' at time zone tz)` and fails outright. Without the
  -- error it would silently compute the wrong end-of-day.
  with bounds as (
    select
      (date_trunc('day', (now() at time zone p_timezone)) at time zone p_timezone)
        as day_start,
      ((date_trunc('day', (now() at time zone p_timezone)) + interval '1 day')
        at time zone p_timezone) as day_end
  )
  -- The aliases on the FIRST branch name the output columns of the whole
  -- union — without them `order by at_time` has nothing to bind to.
  select 'task'::text as kind, t.id as id, t.title as title,
         t.due_at as at_time, t.priority as priority, t.status as status
  from public.tasks t, bounds b
  where t.user_id = auth.uid()
    and t.deleted_at is null
    and t.status not in ('completed', 'cancelled')
    and t.due_at >= b.day_start and t.due_at < b.day_end
  union all
  select 'reminder'::text, r.id, r.title, r.remind_at, null::text, r.status
  from public.reminders r, bounds b
  where r.user_id = auth.uid()
    and r.status = 'scheduled'
    and r.remind_at >= b.day_start and r.remind_at < b.day_end
  order by at_time asc nulls last;
$$;


create or replace function public.get_due_reminders(p_horizon interval default interval '5 minutes')
returns table (
  id uuid, user_id uuid, title text, description text,
  next_trigger_at timestamptz, recurrence_rule text, timezone text,
  delivery_channel text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.user_id, r.title, r.description,
         coalesce(r.next_trigger_at, r.remind_at), r.recurrence_rule,
         r.timezone, r.delivery_channel
  from public.reminders r
  where r.user_id = auth.uid()
    and r.status = 'scheduled'
    and coalesce(r.next_trigger_at, r.remind_at) <= now() + p_horizon
  order by coalesce(r.next_trigger_at, r.remind_at) asc;
$$;


-- -----------------------------------------------------------------------------
-- Maintenance
-- -----------------------------------------------------------------------------
-- These are invoked by scheduled jobs with the secret key, so they check
-- is_owner() only when a caller is present rather than requiring one.

create or replace function public.purge_expired_approvals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.approvals
     set status = 'expired', updated_at = now()
   where status = 'pending'
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.purge_expired_conversations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.conversation_messages where retention_until < now();
  get diagnostics v_count = row_count;

  -- A conversation whose messages are gone keeps only its summary, which is
  -- the point: continuity without indefinite retention.
  delete from public.conversations
   where retention_until is not null
     and retention_until < now()
     and summary is null;

  return v_count;
end;
$$;

create or replace function public.expire_memories()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.memories
     set status = 'expired', updated_at = now()
   where status in ('suggested', 'confirmed')
     and expires_at is not null
     and expires_at < now()
     and deleted_at is null;
  get diagnostics v_count = row_count;

  -- A suggestion nobody reviewed in 30 days is not going to be reviewed.
  update public.memories
     set status = 'expired', updated_at = now()
   where status = 'suggested'
     and created_at < now() - interval '30 days'
     and deleted_at is null;

  return v_count;
end;
$$;

create or replace function public.purge_action_logs(p_retain_days integer default 365)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.action_logs
   where created_at < now() - make_interval(days => greatest(p_retain_days, 1));
  get diagnostics v_count = row_count;

  delete from public.tool_runs
   where created_at < now() - interval '90 days';

  return v_count;
end;
$$;


-- -----------------------------------------------------------------------------
-- Data rights: export and complete deletion
-- -----------------------------------------------------------------------------

-- Token columns are not selected anywhere below. They are excluded BY
-- CONSTRUCTION rather than by a filter that could later be relaxed.
create or replace function public.export_all_user_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = v_uid),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = v_uid),
    'connected_accounts', (
      select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      from public.connected_account_status c where c.user_id = v_uid
    ),
    'memories', (
      select coalesce(jsonb_agg(to_jsonb(m) - 'embedding' - 'search_vector'), '[]'::jsonb)
      from public.memories m where m.user_id = v_uid
    ),
    'memory_versions', (
      select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
      from public.memory_versions v where v.user_id = v_uid
    ),
    'tasks', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      from public.tasks t where t.user_id = v_uid
    ),
    'reminders', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from public.reminders r where r.user_id = v_uid
    ),
    'ideas', (
      select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
      from public.ideas i where i.user_id = v_uid
    ),
    'approvals', (
      select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
      from public.approvals a where a.user_id = v_uid
    ),
    'action_logs', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
      from public.action_logs l where l.user_id = v_uid
    ),
    'conversations', (
      select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      from public.conversations c where c.user_id = v_uid
    ),
    'conversation_messages', (
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
      from public.conversation_messages m where m.user_id = v_uid
    ),
    'research_reports', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from public.research_reports r where r.user_id = v_uid
    ),
    'research_sources', (
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
      from public.research_sources s where s.user_id = v_uid
    ),
    'daily_briefings', (
      select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
      from public.daily_briefings b where b.user_id = v_uid
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.export_all_user_data() is
  'Complete export of the caller''s own data. Token columns, embeddings and '
  'push credentials are excluded by construction — they are never selected.';

revoke all on function public.export_all_user_data() from public, anon;
grant execute on function public.export_all_user_data() to authenticated;


create or replace function public.delete_all_user_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted jsonb := '{}'::jsonb;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Ordered so foreign keys are always satisfied. Children first.
  delete from public.conversation_messages where user_id = v_uid;
  get diagnostics v_count = row_count;
  v_deleted := v_deleted || jsonb_build_object('conversation_messages', v_count);

  delete from public.conversations where user_id = v_uid;
  delete from public.research_sources where user_id = v_uid;
  delete from public.research_reports where user_id = v_uid;
  delete from public.memory_versions where user_id = v_uid;

  -- Break the self-reference before deleting, or the FK blocks the delete.
  update public.memories set superseded_by = null where user_id = v_uid;
  delete from public.memories where user_id = v_uid;
  get diagnostics v_count = row_count;
  v_deleted := v_deleted || jsonb_build_object('memories', v_count);

  delete from public.action_logs where user_id = v_uid;
  delete from public.tool_runs where user_id = v_uid;
  update public.approvals set supersedes_approval_id = null where user_id = v_uid;
  delete from public.approvals where user_id = v_uid;

  delete from public.reminders where user_id = v_uid;
  delete from public.tasks where user_id = v_uid;
  delete from public.ideas where user_id = v_uid;
  delete from public.daily_briefings where user_id = v_uid;
  delete from public.notification_subscriptions where user_id = v_uid;
  delete from public.connected_accounts where user_id = v_uid;
  delete from public.user_settings where user_id = v_uid;
  delete from public.profiles where user_id = v_uid;

  return jsonb_build_object(
    'deleted_at', now(),
    'counts', v_deleted,
    'note', 'Revoke Google access separately at myaccount.google.com/permissions.'
  );
end;
$$;

comment on function public.delete_all_user_data() is
  'Irreversibly deletes every Atlas record for the caller, in foreign-key-safe '
  'order. Google tokens are destroyed here, but only Google can revoke the '
  'grant on their side.';

revoke all on function public.delete_all_user_data() from public, anon;
grant execute on function public.delete_all_user_data() to authenticated;


-- Read-only grants for the retrieval helpers.
revoke all on function public.search_memories_semantic(extensions.vector, integer, numeric)
  from public, anon;
grant execute on function public.search_memories_semantic(extensions.vector, integer, numeric)
  to authenticated;

revoke all on function public.search_memories_hybrid(text, extensions.vector, text[], integer, boolean)
  from public, anon;
grant execute on function public.search_memories_hybrid(text, extensions.vector, text[], integer, boolean)
  to authenticated;

revoke all on function public.get_overdue_tasks(integer) from public, anon;
grant execute on function public.get_overdue_tasks(integer) to authenticated;

revoke all on function public.get_today_agenda(text) from public, anon;
grant execute on function public.get_today_agenda(text) to authenticated;

revoke all on function public.get_due_reminders(interval) from public, anon;
grant execute on function public.get_due_reminders(interval) to authenticated;

-- Maintenance functions are for scheduled jobs only.
revoke all on function public.purge_expired_approvals() from public, anon, authenticated;
revoke all on function public.purge_expired_conversations() from public, anon, authenticated;
revoke all on function public.expire_memories() from public, anon, authenticated;
revoke all on function public.purge_action_logs(integer) from public, anon, authenticated;

-- ####################################################################
-- # 20260806000011_private_schema_rpc.sql
-- ####################################################################

-- =============================================================================
-- 0011 — Reach the private schema through public functions
-- =============================================================================
--
-- Purpose:
--   Fix a lock-out. The application read `private.allowed_users` through the
--   Supabase REST client (`.schema('private')`). That goes via PostgREST,
--   which serves ONLY the schemas listed under Data API -> Exposed schemas —
--   and `private` is deliberately not among them.
--
--   The secret key bypasses Row Level Security. It does NOT bypass schema
--   exposure. So the query failed, the owner check failed closed, and the
--   owner was refused entry to his own application.
--
--   Failing closed was right. Reading through a channel that cannot see the
--   schema was not.
--
--   The fix is not to expose `private` — that would weaken the boundary to
--   work around a client-side mistake. Instead, a small number of
--   security-definer functions in `public` provide exactly the operations
--   needed, and nothing more. `public` is exposed, so RPC reaches them; the
--   functions run as owner, so they can see `private`; and EXECUTE is granted
--   only to `service_role`, so no browser client can call them.
--
-- Rollback:
--   drop function if exists public.owner_allowlist_check(text);
--   drop function if exists public.owner_allowlist_upsert(text);
--   drop function if exists public.owner_allowlist_list();
--   drop function if exists public.job_claim(text, text);
--   drop function if exists public.job_finish(uuid, text, text, jsonb, integer);
--   -- Dropping these locks the owner out again and stops scheduled jobs.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- owner_allowlist_check — used by isOwner() on every protected request
-- -----------------------------------------------------------------------------
-- Normalises inside the function, so a caller passing the raw address Google
-- returned gets the right answer. That normalisation living in one place is
-- the point: it was implemented twice before and drifted.

create or replace function public.owner_allowlist_check(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_email_allowed(p_email);
$$;

comment on function public.owner_allowlist_check(text) is
  'True when the address maps to an enabled allowlist row. Normalises the '
  'input, so callers may pass the raw address from the identity provider. '
  'service_role only — a client able to call this could enumerate which '
  'addresses are permitted.';

revoke all on function public.owner_allowlist_check(text) from public, anon, authenticated;
grant execute on function public.owner_allowlist_check(text) to service_role;


-- -----------------------------------------------------------------------------
-- owner_allowlist_upsert — used by scripts/seed-owner.ts
-- -----------------------------------------------------------------------------
-- Normalises before writing, so the stored form always matches what
-- owner_allowlist_check looks up. Storing a raw address here is precisely how
-- the original lock-out happened.

create or replace function public.owner_allowlist_upsert(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Declared as `text`, not `citext`. With search_path pinned to '' an
  -- unqualified `citext` cannot be resolved — the type lives in the
  -- `extensions` schema. Assigning into the citext column below casts
  -- implicitly, so nothing is lost.
  v_email text := private.normalise_email(p_email);
begin
  if v_email is null then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  insert into private.allowed_users (email, enabled)
  values (v_email, true)
  on conflict (email) do update set enabled = true, updated_at = now();

  return v_email;
end;
$$;

comment on function public.owner_allowlist_upsert(text) is
  'Adds or re-enables an allowlist entry, storing the NORMALISED address. '
  'service_role only.';

revoke all on function public.owner_allowlist_upsert(text) from public, anon, authenticated;
grant execute on function public.owner_allowlist_upsert(text) to service_role;


-- -----------------------------------------------------------------------------
-- owner_allowlist_list — used by scripts/verify-live.ts
-- -----------------------------------------------------------------------------
-- Returns counts, never addresses: a diagnostic should not print who is
-- allowed, and its output is meant to be safe to paste into a chat.

create or replace function public.owner_allowlist_list()
returns table (total integer, enabled_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::integer,
    count(*) filter (where enabled)::integer
  from private.allowed_users;
$$;

revoke all on function public.owner_allowlist_list() from public, anon, authenticated;
grant execute on function public.owner_allowlist_list() to service_role;


-- -----------------------------------------------------------------------------
-- job_claim / job_finish — used by the Edge Functions
-- -----------------------------------------------------------------------------
-- Same problem, same fix: the scheduled jobs wrote to private.job_runs through
-- PostgREST and would have failed for the same reason, silently, at 01:00 UTC.

create or replace function public.job_claim(p_job_name text, p_run_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- `on conflict do nothing` plus a returned row IS the lock. No row means
  -- another invocation owns this unit of work.
  insert into private.job_runs (job_name, run_key, status)
  values (p_job_name, p_run_key, 'running')
  on conflict (job_name, run_key) do nothing
  returning id into v_id;

  return v_id;  -- null when already claimed
end;
$$;

comment on function public.job_claim(text, text) is
  'Claims a unit of scheduled work. Returns the run id, or NULL when another '
  'invocation already holds it. service_role only.';

revoke all on function public.job_claim(text, text) from public, anon, authenticated;
grant execute on function public.job_claim(text, text) to service_role;


create or replace function public.job_finish(
  p_run_id uuid,
  p_status text,
  p_error_code text default null,
  p_details jsonb default '{}'::jsonb,
  p_duration_ms integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.job_runs
     set status       = p_status,
         completed_at = now(),
         duration_ms  = p_duration_ms,
         error_code   = p_error_code,
         details      = coalesce(p_details, '{}'::jsonb)
   where id = p_run_id;
end;
$$;

revoke all on function public.job_finish(uuid, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.job_finish(uuid, text, text, jsonb, integer) to service_role;
-- =============================================================================
-- LAST STEP — add yourself to the allowlist
-- =============================================================================
--
-- Without this, NOBODY can sign in, including you.
-- Uncomment, put YOUR address in, and run. The function normalises and stores
-- the correct form, so you cannot get it subtly wrong.

-- select public.owner_allowlist_upsert('you@gmail.com');

-- Confirm — should return true:
-- select public.owner_allowlist_check('you@gmail.com');
