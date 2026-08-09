-- =============================================================================
-- 0014 — Atlas Ideas & Planner
-- =============================================================================
--
-- Extends the existing Ideas, Tasks and Reminders model. This does not create
-- a second project system: an Idea owns ordered steps, and approved steps link
-- to the existing task/reminder rows plus an optional Google Calendar event.
--
-- Safety properties:
--   * original_capture is immutable after insert
--   * planning is draft data until one approval executes it
--   * completed steps survive re-planning
--   * stale cleanup only surfaces candidates; it never deletes automatically
--   * linked rows remain owner-scoped through RLS
-- =============================================================================

begin;

alter table public.ideas
  add column if not exists understanding text,
  add column if not exists instructions jsonb not null default '[]'::jsonb,
  add column if not exists next_action_at timestamptz,
  add column if not exists next_action_duration_minutes integer,
  add column if not exists plan_version integer not null default 0,
  add column if not exists approved_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_touched_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists archived_from_status text,
  add column if not exists pending_approval_id uuid references public.approvals(id) on delete set null;

-- Composite keys let every child prove that its referenced parent belongs to
-- the same owner. UUID knowledge alone must never allow a cross-owner link.
alter table public.ideas add constraint ideas_id_user_unique unique (id, user_id);
alter table public.tasks add constraint tasks_id_user_unique unique (id, user_id);
alter table public.reminders add constraint reminders_id_user_unique unique (id, user_id);

alter table public.ideas drop constraint if exists ideas_status_check;

update public.ideas
set status = case status
  when 'exploring' then 'planned'
  when 'building' then 'in_progress'
  when 'parked' then 'archived'
  else status
end,
archived_at = case when status = 'parked' then coalesce(archived_at, now()) else archived_at end;

update public.ideas
set completed_at = coalesce(completed_at, updated_at, now())
where status = 'completed';

update public.ideas
set archived_at = coalesce(archived_at, updated_at, now())
where status = 'archived';

alter table public.ideas
  add constraint ideas_status_check check (status in (
    'captured', 'planned', 'in_progress', 'completed', 'archived'
  )),
  add constraint ideas_instructions_array_check check (jsonb_typeof(instructions) = 'array'),
  add constraint ideas_duration_check check (
    next_action_duration_minutes is null
    or next_action_duration_minutes between 5 and 480
  ),
  add constraint ideas_plan_version_check check (plan_version >= 0),
  add constraint ideas_archived_from_status_check check (
    archived_from_status is null
    or archived_from_status in ('captured', 'planned', 'in_progress', 'completed')
  ),
  add constraint ideas_completed_consistency check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  add constraint ideas_archived_consistency check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  );

create or replace function private.preserve_idea_original_capture()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.original_capture is distinct from old.original_capture then
    raise exception 'idea_original_capture_is_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ideas_preserve_original_capture on public.ideas;
create trigger ideas_preserve_original_capture
  before update of original_capture on public.ideas
  for each row execute function private.preserve_idea_original_capture();

create table if not exists public.idea_steps (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  idea_id               uuid not null references public.ideas(id) on delete cascade,
  position              integer not null,
  title                 text not null,
  description           text,
  status                text not null default 'pending',
  required              boolean not null default true,
  duration_minutes      integer not null default 30,
  scheduled_start       timestamptz,
  scheduled_end         timestamptz,
  task_id               uuid references public.tasks(id) on delete set null,
  reminder_id           uuid references public.reminders(id) on delete set null,
  google_calendar_event_id text,
  completed_at          timestamptz,
  needs_attention_at    timestamptz,
  notify_upcoming       boolean not null default true,
  notify_execute        boolean not null default true,
  notify_plan_check     boolean not null default true,
  upcoming_notified_at  timestamptz,
  execute_notified_at   timestamptz,
  plan_check_notified_at timestamptz,
  plan_version          integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint idea_steps_idea_owner_fk foreign key (idea_id, user_id)
    references public.ideas(id, user_id) on delete cascade,
  constraint idea_steps_task_owner_fk foreign key (task_id, user_id)
    references public.tasks(id, user_id),
  constraint idea_steps_reminder_owner_fk foreign key (reminder_id, user_id)
    references public.reminders(id, user_id),
  constraint idea_steps_position_check check (position >= 0),
  constraint idea_steps_status_check check (status in (
    'pending', 'in_progress', 'completed', 'skipped'
  )),
  constraint idea_steps_duration_check check (duration_minutes between 5 and 480),
  constraint idea_steps_schedule_check check (
    (scheduled_start is null and scheduled_end is null)
    or (scheduled_start is not null and scheduled_end is not null and scheduled_end > scheduled_start)
  ),
  constraint idea_steps_completed_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  constraint idea_steps_version_check check (plan_version > 0)
);

create table if not exists public.idea_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  idea_id    uuid not null references public.ideas(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint idea_notes_idea_owner_fk foreign key (idea_id, user_id)
    references public.ideas(id, user_id) on delete cascade,
  constraint idea_notes_content_check check (char_length(btrim(content)) between 1 and 8000)
);

alter table public.idea_steps
  add constraint idea_steps_id_user_unique unique (id, user_id);

alter table public.tasks
  add column if not exists idea_id uuid references public.ideas(id) on delete set null,
  add column if not exists idea_step_id uuid references public.idea_steps(id) on delete set null,
  add column if not exists needs_attention_at timestamptz;

alter table public.reminders
  add column if not exists idea_id uuid references public.ideas(id) on delete set null,
  add column if not exists idea_step_id uuid references public.idea_steps(id) on delete set null;

alter table public.tasks
  add constraint tasks_idea_owner_fk foreign key (idea_id, user_id)
    references public.ideas(id, user_id),
  add constraint tasks_idea_step_owner_fk foreign key (idea_step_id, user_id)
    references public.idea_steps(id, user_id),
  add constraint tasks_idea_link_check check (idea_step_id is null or idea_id is not null);

alter table public.reminders
  add constraint reminders_idea_owner_fk foreign key (idea_id, user_id)
    references public.ideas(id, user_id),
  add constraint reminders_idea_step_owner_fk foreign key (idea_step_id, user_id)
    references public.idea_steps(id, user_id),
  add constraint reminders_idea_link_check check (idea_step_id is null or idea_id is not null);

create unique index if not exists tasks_one_per_idea_step_idx
  on public.tasks (idea_step_id) where idea_step_id is not null and deleted_at is null;
create unique index if not exists reminders_one_per_idea_step_idx
  on public.reminders (idea_step_id) where idea_step_id is not null;
create index if not exists idea_steps_idea_order_idx
  on public.idea_steps (idea_id, position, created_at);
create index if not exists idea_steps_notifications_idx
  on public.idea_steps (scheduled_start)
  where status not in ('completed', 'skipped') and scheduled_start is not null;
create index if not exists idea_notes_idea_idx
  on public.idea_notes (idea_id, created_at desc);
create index if not exists ideas_active_next_action_idx
  on public.ideas (user_id, next_action_at)
  where deleted_at is null and status in ('planned', 'in_progress');
create index if not exists ideas_stale_cleanup_idx
  on public.ideas (user_id, last_touched_at)
  where deleted_at is null and status in ('captured', 'planned', 'in_progress');

drop trigger if exists idea_steps_set_updated_at on public.idea_steps;
create trigger idea_steps_set_updated_at before update on public.idea_steps
  for each row execute function private.set_updated_at();
drop trigger if exists idea_notes_set_updated_at on public.idea_notes;
create trigger idea_notes_set_updated_at before update on public.idea_notes
  for each row execute function private.set_updated_at();

create or replace function private.touch_parent_idea()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_idea_id uuid;
  v_old_idea_id uuid;
begin
  if tg_op = 'DELETE' then
    v_old_idea_id := old.idea_id;
    if v_old_idea_id is not null then
      update public.ideas set last_touched_at = now() where id = v_old_idea_id;
    end if;
    return old;
  end if;

  v_new_idea_id := new.idea_id;
  if v_new_idea_id is not null then
    update public.ideas set last_touched_at = now() where id = v_new_idea_id;
  end if;

  if tg_op = 'UPDATE' then
    v_old_idea_id := old.idea_id;
    if v_old_idea_id is not null and v_old_idea_id is distinct from v_new_idea_id then
      update public.ideas set last_touched_at = now() where id = v_old_idea_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists idea_steps_touch_parent on public.idea_steps;
create trigger idea_steps_touch_parent
  after insert or update or delete on public.idea_steps
  for each row execute function private.touch_parent_idea();
drop trigger if exists idea_notes_touch_parent on public.idea_notes;
create trigger idea_notes_touch_parent
  after insert or update or delete on public.idea_notes
  for each row execute function private.touch_parent_idea();
drop trigger if exists tasks_touch_parent_idea on public.tasks;
create trigger tasks_touch_parent_idea
  after insert or update or delete on public.tasks
  for each row execute function private.touch_parent_idea();
drop trigger if exists reminders_touch_parent_idea on public.reminders;
create trigger reminders_touch_parent_idea
  after insert or update or delete on public.reminders
  for each row execute function private.touch_parent_idea();

alter table public.idea_steps enable row level security;
alter table public.idea_notes enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['idea_steps', 'idea_notes']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)',
      t || '_delete_own', t);
  end loop;
end
$$;

grant select, insert, update, delete on public.idea_steps, public.idea_notes to authenticated;

-- Include planner children in the existing complete user export. Push
-- credentials remain omitted exactly as before.
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
    'idea_steps', (
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
      from public.idea_steps s where s.user_id = v_uid
    ),
    'idea_notes', (
      select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
      from public.idea_notes n where n.user_id = v_uid
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
  'Complete export of the caller''s own data, including idea plans and notes. '
  'Token columns, embeddings and push credentials are excluded by construction.';

revoke all on function public.export_all_user_data() from public, anon;
grant execute on function public.export_all_user_data() to authenticated;

commit;
