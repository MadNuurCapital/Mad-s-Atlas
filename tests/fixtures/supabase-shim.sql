-- =============================================================================
-- TEST FIXTURE — a minimal stand-in for Supabase's managed pieces
-- =============================================================================
--
-- This file is NOT part of the application and is NEVER deployed. It exists so
-- the real migrations can be executed against a plain PostgreSQL server, which
-- is what makes the RLS and approval guarantees testable rather than merely
-- asserted.
--
-- It provides only what the migrations actually depend on:
--   * the `auth` schema, `auth.users`, and `auth.uid()`
--   * the anon / authenticated / service_role / supabase_auth_admin roles
--   * a `pg_net` stand-in, because that extension is Supabase-specific
--
-- On Supabase these are all real. Anything the shim gets wrong would show up
-- there, so it is kept as thin as possible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- auth schema
-- -----------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to authenticated, service_role, supabase_auth_admin;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

grant select on auth.users to authenticated, service_role;

-- Supabase derives auth.uid() from the request JWT. Locally the test harness
-- sets `request.jwt.claim.sub` per connection to impersonate a user, which is
-- exactly what PostgREST does under the hood.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- pg_net stand-in
-- -----------------------------------------------------------------------------
-- Only cron uses this, to invoke Edge Functions. Recording the call rather
-- than making it lets the scheduled-job tests assert what WOULD have been
-- invoked without any network access.
create schema if not exists net;

create table if not exists net.sent_requests (
  id         bigserial primary key,
  url        text not null,
  headers    jsonb,
  body       jsonb,
  created_at timestamptz not null default now()
);

create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language sql
as $$
  insert into net.sent_requests (url, headers, body)
  values (url, headers, body)
  returning id;
$$;


-- -----------------------------------------------------------------------------
-- pg_cron stand-in
-- -----------------------------------------------------------------------------
-- Records schedules so tests can assert cron expressions without a scheduler.
create schema if not exists cron;

create table if not exists cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null,
  active   boolean not null default true
);

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language sql
as $$
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update
    set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;
