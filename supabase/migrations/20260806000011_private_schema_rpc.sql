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
