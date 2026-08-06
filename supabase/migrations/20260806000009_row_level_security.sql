-- =============================================================================
-- 0009 — Row Level Security
-- =============================================================================
--
-- Purpose:
--   Enable RLS on every table in `public` and restrict every row to its owner.
--
-- This holds even though there is exactly one user. Writing it securely now
-- costs nothing; retrofitting it onto populated tables is how gaps survive.
--
-- Rules, without exception:
--   * No policy grants `anon`.
--   * No policy uses `true` as its predicate.
--   * No blanket grant to `authenticated`.
--   * Tables written only by server code get NO insert policy — those writes
--     use the secret key, which bypasses RLS by design. That is precisely why
--     the secret key must never reach the browser.
--
-- Rollback:
--   Dropping policies WEAKENS security. Do not do it to "fix" a query — a
--   query that needs a dropped policy is querying with the wrong client.
--
-- =============================================================================

alter table public.profiles                  enable row level security;
alter table public.user_settings             enable row level security;
alter table public.connected_accounts        enable row level security;
alter table public.memories                  enable row level security;
alter table public.memory_versions           enable row level security;
alter table public.tasks                     enable row level security;
alter table public.reminders                 enable row level security;
alter table public.ideas                     enable row level security;
alter table public.approvals                 enable row level security;
alter table public.action_logs               enable row level security;
alter table public.tool_runs                 enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_messages     enable row level security;
alter table public.research_reports          enable row level security;
alter table public.research_sources          enable row level security;
alter table public.daily_briefings           enable row level security;
alter table public.notification_subscriptions enable row level security;


-- -----------------------------------------------------------------------------
-- Full ownership: select / insert / update / delete
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'memories', 'tasks', 'reminders', 'ideas', 'conversations'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated
         using (auth.uid() = user_id)', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (auth.uid() = user_id)', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (auth.uid() = user_id)', t || '_delete_own', t);
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- profiles / user_settings — own row, but never deletable directly
-- -----------------------------------------------------------------------------
-- Deletion happens through delete_all_user_data() or account removal, so the
-- two rows cannot be orphaned by a stray DELETE.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- connected_accounts — NO client select policy at all
-- -----------------------------------------------------------------------------
-- The token columns live on this table, so clients get no read access to it.
-- They read public.connected_account_status instead, which has no token
-- columns to leak. Disconnecting is a delete the user may perform.

drop policy if exists connected_accounts_delete_own on public.connected_accounts;
create policy connected_accounts_delete_own on public.connected_accounts
  for delete to authenticated using (auth.uid() = user_id);

-- The view is security_invoker, so it needs a select policy on the base table
-- to work. Scoped to the owner and, critically, the VIEW is what clients are
-- granted on — see the grants at the end of this file.
drop policy if exists connected_accounts_select_own on public.connected_accounts;
create policy connected_accounts_select_own on public.connected_accounts
  for select to authenticated using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- Read-only to the client; written by server code with the secret key
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'memory_versions', 'action_logs', 'tool_runs', 'research_reports',
    'research_sources', 'daily_briefings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (auth.uid() = user_id)', t || '_select_own', t);
  end loop;
end
$$;

-- Research and briefings may be deleted by their owner (data rights).
drop policy if exists research_reports_delete_own on public.research_reports;
create policy research_reports_delete_own on public.research_reports
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists daily_briefings_delete_own on public.daily_briefings;
create policy daily_briefings_delete_own on public.daily_briefings
  for delete to authenticated using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- approvals — select and update only
-- -----------------------------------------------------------------------------
-- No client INSERT: approvals are created by the orchestrator, so a client
-- cannot fabricate one for an action Atlas never proposed.
-- No client DELETE: the record of what was proposed is part of the audit trail.
--
-- The UPDATE policy allows recording a decision. It does NOT allow executing:
-- the transition to 'executed' happens only inside claim_approval(), and the
-- WITH CHECK below refuses any client-side attempt to set that status.

drop policy if exists approvals_select_own on public.approvals;
create policy approvals_select_own on public.approvals
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists approvals_decide_own on public.approvals;
create policy approvals_decide_own on public.approvals
  for update to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status in ('approved', 'rejected'));

comment on policy approvals_decide_own on public.approvals is
  'Lets the owner approve or reject a PENDING approval. Cannot set '
  '''executed'' — only claim_approval() can, atomically.';


-- -----------------------------------------------------------------------------
-- conversation_messages — immutable once written
-- -----------------------------------------------------------------------------

drop policy if exists conversation_messages_select_own on public.conversation_messages;
create policy conversation_messages_select_own on public.conversation_messages
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists conversation_messages_insert_own on public.conversation_messages;
create policy conversation_messages_insert_own on public.conversation_messages
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists conversation_messages_delete_own on public.conversation_messages;
create policy conversation_messages_delete_own on public.conversation_messages
  for delete to authenticated using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- notification_subscriptions
-- -----------------------------------------------------------------------------

drop policy if exists notification_subscriptions_select_own on public.notification_subscriptions;
create policy notification_subscriptions_select_own on public.notification_subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists notification_subscriptions_insert_own on public.notification_subscriptions;
create policy notification_subscriptions_insert_own on public.notification_subscriptions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists notification_subscriptions_update_own on public.notification_subscriptions;
create policy notification_subscriptions_update_own on public.notification_subscriptions
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists notification_subscriptions_delete_own on public.notification_subscriptions;
create policy notification_subscriptions_delete_own on public.notification_subscriptions
  for delete to authenticated using (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- Table-level grants
-- -----------------------------------------------------------------------------
-- RLS filters rows, but a role still needs a GRANT to touch the table at all.
-- Supabase happens to grant these to `authenticated` by default, so omitting
-- them appears to work there and fails everywhere else — and inheriting access
-- control from a platform default is not something worth depending on. These
-- grants mirror the policy matrix in DATABASE_SCHEMA.md exactly.

-- Full CRUD.
grant select, insert, update, delete on
  public.memories, public.tasks, public.reminders, public.ideas,
  public.conversations
  to authenticated;

-- Own row, but deletion goes through delete_all_user_data() only.
grant select, insert, update on public.profiles, public.user_settings
  to authenticated;

-- Append-only from the client's perspective; written server-side.
grant select on
  public.memory_versions, public.action_logs, public.tool_runs,
  public.research_sources
  to authenticated;

-- Readable, and deletable as a data right.
grant select, delete on public.research_reports, public.daily_briefings
  to authenticated;

-- Approvals: no INSERT (the orchestrator creates them, so a client cannot
-- fabricate one) and no DELETE (the record is part of the audit trail).
-- UPDATE is constrained further by the approvals_decide_own policy.
grant select, update on public.approvals to authenticated;

-- Messages are immutable once written.
grant select, insert, delete on public.conversation_messages to authenticated;

-- Views the client reads instead of the sensitive base tables.
grant select on public.connected_account_status to authenticated;
grant select on public.notification_subscription_status to authenticated;


-- -----------------------------------------------------------------------------
-- Column-level grants
-- -----------------------------------------------------------------------------
-- RLS decides WHICH ROWS. These grants decide WHICH COLUMNS. Revoking the
-- token columns means that even a policy mistake cannot expose them: there is
-- no grant under which a client may select them.

revoke all on public.connected_accounts from anon, authenticated;
grant select (
  id, user_id, provider, provider_account_id, email, granted_scopes,
  connection_status, access_token_expires_at, last_refreshed_at,
  created_at, updated_at
) on public.connected_accounts to authenticated;
grant delete on public.connected_accounts to authenticated;

revoke all on public.notification_subscriptions from anon, authenticated;
grant select (id, user_id, endpoint, user_agent, enabled, created_at, updated_at)
  on public.notification_subscriptions to authenticated;
grant insert, update, delete on public.notification_subscriptions to authenticated;

-- Nothing in public is reachable anonymously.
revoke all on all tables in schema public from anon;
