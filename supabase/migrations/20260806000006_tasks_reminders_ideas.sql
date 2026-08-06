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
