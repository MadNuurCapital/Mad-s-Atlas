-- =============================================================================
-- 0013 — Self-learning and evolution engine
-- =============================================================================
--
-- Adds an evidence-backed learning layer without changing the semantics of
-- public.memories. Confirmed memories remain the only personal facts Atlas may
-- treat as true; learned items keep observations and inferences visibly
-- separate until the owner confirms them.
--
-- Rollback (preserves the pre-existing memory system):
--   drop function if exists public.reset_learning_engine();
--   drop table if exists public.learning_feedback;
--   drop table if exists public.evolution_proposals;
--   drop table if exists public.system_metrics;
--   drop table if exists public.atlas_adaptations;
--   drop table if exists public.learning_items;
--   alter table public.user_settings drop column if exists learning_enabled,
--     drop column if exists learning_paused_until,
--     drop column if exists proactive_suggestions_enabled,
--     drop column if exists workflow_learning_enabled,
--     drop column if exists system_diagnostics_enabled,
--     drop column if exists automatic_adaptations_enabled;
--
-- =============================================================================

alter table public.user_settings
  add column if not exists learning_enabled boolean not null default true,
  add column if not exists learning_paused_until timestamptz,
  add column if not exists proactive_suggestions_enabled boolean not null default true,
  add column if not exists workflow_learning_enabled boolean not null default true,
  add column if not exists system_diagnostics_enabled boolean not null default true,
  add column if not exists automatic_adaptations_enabled boolean not null default false;

create table if not exists public.learning_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  category text not null,
  canonical_key text not null,
  title text not null,
  summary text not null,
  status text not null default 'observed',
  confidence numeric(4,3) not null default 0.300,
  evidence jsonb not null default '[]'::jsonb,
  evidence_count integer not null default 1,
  source_type text not null default 'system',
  source_reference text,
  user_confirmed boolean not null default false,
  pinned boolean not null default false,
  feedback_score integer not null default 0,
  first_observed_at timestamptz not null default now(),
  last_reinforced_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  superseded_by uuid references public.learning_items(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint learning_items_kind_check check (kind in (
    'observation', 'inference', 'confirmed_memory', 'system_insight', 'workflow', 'decision'
  )),
  constraint learning_items_category_check check (category in (
    'facts', 'preferences', 'routines', 'people', 'projects', 'goals',
    'decisions', 'workflows', 'communication', 'research', 'productivity', 'system'
  )),
  constraint learning_items_status_check check (status in (
    'observed', 'emerging', 'suggested', 'confirmed', 'active',
    'retired', 'superseded', 'dismissed'
  )),
  constraint learning_items_source_check check (source_type in (
    'voice', 'text', 'tool_usage', 'calendar', 'task', 'reminder',
    'research', 'feedback', 'reflection', 'manual', 'system'
  )),
  constraint learning_items_confidence_check check (confidence between 0 and 1),
  constraint learning_items_evidence_array_check check (jsonb_typeof(evidence) = 'array'),
  constraint learning_items_evidence_count_check check (evidence_count >= 0),
  constraint learning_items_unique_key unique (user_id, kind, canonical_key)
);

comment on table public.learning_items is
  'Evidence-backed observations, inferences, workflows and insights. Inferred '
  'items stay separate from confirmed personal memory and visibly carry confidence.';
comment on column public.learning_items.evidence is
  'Bounded safe references and timestamps only. Never raw email bodies, audio, tokens or secrets.';

create index if not exists learning_items_review_idx
  on public.learning_items (user_id, status, confidence desc, updated_at desc)
  where deleted_at is null;
create index if not exists learning_items_context_idx
  on public.learning_items (user_id, category, last_reinforced_at desc)
  where deleted_at is null and status in ('confirmed', 'active');
create index if not exists learning_items_workflow_idx
  on public.learning_items (user_id, status, evidence_count desc)
  where deleted_at is null and kind = 'workflow';

create table if not exists public.atlas_adaptations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  adaptation_key text not null,
  category text not null,
  title text not null,
  description text not null,
  value jsonb not null default '{}'::jsonb,
  previous_value jsonb,
  reason text not null,
  confidence numeric(4,3) not null,
  evidence jsonb not null default '[]'::jsonb,
  risk_level text not null default 'low',
  status text not null default 'proposed',
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_adaptations_category_check check (category in (
    'behavioral', 'workflow', 'performance', 'reliability', 'ui', 'intelligence', 'cost', 'security'
  )),
  constraint atlas_adaptations_risk_check check (risk_level in ('low', 'medium', 'high')),
  constraint atlas_adaptations_status_check check (status in ('proposed', 'active', 'reverted', 'dismissed')),
  constraint atlas_adaptations_confidence_check check (confidence between 0 and 1),
  constraint atlas_adaptations_unique_key unique (user_id, adaptation_key)
);

create index if not exists atlas_adaptations_active_idx
  on public.atlas_adaptations (user_id, status, updated_at desc);

create table if not exists public.system_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subsystem text not null,
  metric_name text not null,
  metric_value numeric not null,
  unit text not null,
  sample_count integer not null default 1,
  health_status text not null default 'healthy',
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  constraint system_metrics_status_check check (health_status in ('healthy', 'watch', 'degraded')),
  constraint system_metrics_sample_check check (sample_count >= 0),
  constraint system_metrics_window_check check (window_ended_at >= window_started_at),
  constraint system_metrics_unique_window unique (user_id, subsystem, metric_name, window_started_at)
);

comment on table public.system_metrics is
  'Privacy-preserving aggregate counts, timing and error rates. No user content or external payloads.';
create index if not exists system_metrics_trend_idx
  on public.system_metrics (user_id, subsystem, metric_name, recorded_at desc);

create table if not exists public.evolution_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  title text not null,
  problem text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null,
  proposed_solution text not null,
  expected_benefit text not null,
  risk_level text not null,
  affected_systems text[] not null default '{}',
  test_plan text[] not null default '{}',
  proposal_text text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dismissed_at timestamptz,
  constraint evolution_proposals_category_check check (category in (
    'behavioral', 'workflow', 'performance', 'reliability', 'ui', 'intelligence', 'cost', 'security'
  )),
  constraint evolution_proposals_risk_check check (risk_level in ('low', 'medium', 'high')),
  constraint evolution_proposals_status_check check (status in ('open', 'accepted', 'dismissed', 'exported')),
  constraint evolution_proposals_confidence_check check (confidence between 0 and 1)
);

comment on table public.evolution_proposals is
  'Reviewable improvement proposals. proposal_text is inert text for export; it is never executed.';
create index if not exists evolution_proposals_open_idx
  on public.evolution_proposals (user_id, status, confidence desc, created_at desc);

create table if not exists public.learning_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_item_id uuid references public.learning_items(id) on delete set null,
  adaptation_id uuid references public.atlas_adaptations(id) on delete set null,
  feedback_type text not null,
  source text not null default 'ui',
  note text,
  created_at timestamptz not null default now(),
  constraint learning_feedback_type_check check (feedback_type in (
    'useful', 'not_useful', 'confirm', 'correct', 'dismiss', 'revert', 'outcome_success', 'outcome_failure'
  )),
  constraint learning_feedback_source_check check (source in ('ui', 'voice', 'text', 'outcome', 'system'))
);
create index if not exists learning_feedback_recent_idx
  on public.learning_feedback (user_id, created_at desc);

-- Updated-at triggers use the existing hardened helper.
drop trigger if exists learning_items_set_updated_at on public.learning_items;
create trigger learning_items_set_updated_at before update on public.learning_items
  for each row execute function private.set_updated_at();
drop trigger if exists atlas_adaptations_set_updated_at on public.atlas_adaptations;
create trigger atlas_adaptations_set_updated_at before update on public.atlas_adaptations
  for each row execute function private.set_updated_at();
drop trigger if exists evolution_proposals_set_updated_at on public.evolution_proposals;
create trigger evolution_proposals_set_updated_at before update on public.evolution_proposals
  for each row execute function private.set_updated_at();

-- RLS: owner-scoped everywhere. Metrics are server-written; feedback may be
-- inserted by the owner but is immutable afterwards.
alter table public.learning_items enable row level security;
alter table public.atlas_adaptations enable row level security;
alter table public.system_metrics enable row level security;
alter table public.evolution_proposals enable row level security;
alter table public.learning_feedback enable row level security;

do $$
declare t text;
begin
  foreach t in array array['learning_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)', t || '_delete_own', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['atlas_adaptations', 'evolution_proposals'] loop
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)', t || '_delete_own', t);
  end loop;
end $$;

create policy system_metrics_select_own on public.system_metrics
  for select to authenticated using (auth.uid() = user_id);
create policy learning_feedback_select_own on public.learning_feedback
  for select to authenticated using (auth.uid() = user_id);
create policy learning_feedback_insert_own on public.learning_feedback
  for insert to authenticated with check (auth.uid() = user_id);

grant select, insert, update, delete on public.learning_items to authenticated;
grant select, update, delete on public.atlas_adaptations, public.evolution_proposals to authenticated;
grant select on public.system_metrics to authenticated;
grant select, insert on public.learning_feedback to authenticated;
revoke all on
  public.learning_items, public.atlas_adaptations, public.system_metrics,
  public.evolution_proposals, public.learning_feedback
  from anon;

-- Safe owner reset: deletes only inferred learning/adaptation state. Confirmed
-- memories, tasks, calendar data, approvals and audit history are untouched.
create or replace function public.reset_learning_engine()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_count integer; v_out jsonb := '{}'::jsonb;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  delete from public.learning_feedback where user_id = v_uid;
  delete from public.atlas_adaptations where user_id = v_uid;
  delete from public.evolution_proposals where user_id = v_uid;
  delete from public.system_metrics where user_id = v_uid;
  update public.learning_items set superseded_by = null where user_id = v_uid;
  delete from public.learning_items where user_id = v_uid;
  get diagnostics v_count = row_count;
  v_out := jsonb_build_object('deleted_learning_items', v_count, 'reset_at', now());
  return v_out;
end;
$$;
revoke all on function public.reset_learning_engine() from public, anon;
grant execute on function public.reset_learning_engine() to authenticated;

-- Additive export for the evolution layer. The application can combine this
-- with export_all_user_data(); no secret, prompt payload or metric content is
-- excluded by filtering because those values are never stored here at all.
create or replace function public.export_learning_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'learning_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.learning_items i where i.user_id = auth.uid()),
    'learning_feedback', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from public.learning_feedback f where f.user_id = auth.uid()),
    'adaptations', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.atlas_adaptations a where a.user_id = auth.uid()),
    'system_metrics', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.system_metrics m where m.user_id = auth.uid()),
    'evolution_proposals', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.evolution_proposals p where p.user_id = auth.uid())
  );
$$;
revoke all on function public.export_learning_data() from public, anon;
grant execute on function public.export_learning_data() to authenticated;

-- delete_all_user_data() finishes by deleting the owner's profile. This
-- trigger extends that existing transaction to the additive learning tables,
-- so complete deletion remains complete without rewriting the older function.
create or replace function private.delete_learning_with_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.learning_feedback where user_id = old.user_id;
  delete from public.atlas_adaptations where user_id = old.user_id;
  delete from public.evolution_proposals where user_id = old.user_id;
  delete from public.system_metrics where user_id = old.user_id;
  update public.learning_items set superseded_by = null where user_id = old.user_id;
  delete from public.learning_items where user_id = old.user_id;
  return old;
end;
$$;
drop trigger if exists profiles_delete_learning on public.profiles;
create trigger profiles_delete_learning before delete on public.profiles
  for each row execute function private.delete_learning_with_profile();
