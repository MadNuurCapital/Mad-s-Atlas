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
