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
