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
