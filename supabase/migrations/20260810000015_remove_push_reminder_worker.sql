-- =============================================================================
-- 0015 — Retire the push reminder worker
-- =============================================================================
-- Ideas, Tasks, Calendar events and Reminder records remain intact. This only
-- stops the failing background delivery job and makes existing delivery state
-- accurately reflect that Atlas now uses in-app reminders.

begin;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'check_reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$$;

update public.notification_subscriptions set enabled = false where enabled;
update public.user_settings set notification_enabled = false where notification_enabled;
update public.idea_steps
set notify_upcoming = false,
    notify_execute = false,
    notify_plan_check = false
where notify_upcoming or notify_execute or notify_plan_check;
update public.reminders set delivery_channel = 'in_app' where delivery_channel = 'push';
alter table public.reminders alter column delivery_channel set default 'in_app';

comment on table public.notification_subscriptions is
  'Retained legacy subscription records. Push delivery was retired in migration 0015; all rows are disabled.';
comment on column public.user_settings.notification_enabled is
  'Legacy setting retained for schema compatibility. Push delivery is retired and this remains false.';

commit;
