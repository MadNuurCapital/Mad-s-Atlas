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
