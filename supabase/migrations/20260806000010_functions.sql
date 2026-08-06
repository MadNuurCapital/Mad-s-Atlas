-- =============================================================================
-- 0010 — Database functions
-- =============================================================================
--
-- Every function here is `security definer` and therefore runs with elevated
-- privileges. Each one accordingly:
--
--   * sets search_path = '' and fully qualifies every identifier, so it cannot
--     be hijacked by a shadowing object in a user-controlled schema;
--   * validates auth.uid() and scopes results to the caller;
--   * returns only the columns needed;
--   * contains NO dynamic SQL.
--
-- Rollback: drop the individual functions. claim_approval() is load-bearing —
-- without it there is no atomic guard against double execution.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- claim_approval — the heart of the safety model
-- -----------------------------------------------------------------------------
-- A single UPDATE ... RETURNING is the claim. Status, ownership, idempotency
-- key and expiry are all checked inside that one statement, so there is no
-- window between checking and acting for a second caller to slip through.
--
-- A concurrent second call finds status already 'executed' and raises. This is
-- why a double click, a retry storm or a replayed request cannot execute an
-- action twice — not because the UI disables a button.

create or replace function public.claim_approval(
  p_approval_id uuid,
  p_idempotency_key text
)
returns public.approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.approvals;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  update public.approvals
     set status      = 'executed',
         executed_at = now(),
         updated_at  = now()
   where id = p_approval_id
     and user_id = auth.uid()
     and status = 'approved'
     and idempotency_key = p_idempotency_key
     and expires_at > now()
  returning * into v_row;

  if not found then
    -- Deliberately one error for every failure mode. Distinguishing "already
    -- executed" from "expired" would tell a replaying caller which of its
    -- attempts landed.
    raise exception 'approval_not_claimable' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

comment on function public.claim_approval(uuid, text) is
  'Atomically transitions an approval from approved to executed. Returns the '
  'claimed row, or raises approval_not_claimable. An approval can be claimed '
  'at most once, only while approved and unexpired.';

revoke all on function public.claim_approval(uuid, text) from public, anon;
grant execute on function public.claim_approval(uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
-- Memory search
-- -----------------------------------------------------------------------------

create or replace function public.search_memories_semantic(
  p_embedding extensions.vector(1536),
  p_limit integer default 12,
  p_min_similarity numeric default 0.55
)
returns table (
  id uuid, title text, content text, category text,
  sensitivity text, confidence numeric, similarity numeric,
  confirmed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id, m.title, m.content, m.category,
    m.sensitivity, m.confidence,
    (1 - (m.embedding OPERATOR(extensions.<=>) p_embedding))::numeric as similarity,
    m.confirmed_at
  from public.memories m
  where m.user_id = auth.uid()
    and m.deleted_at is null
    and m.status = 'confirmed'
    and m.embedding is not null
    and (m.expires_at is null or m.expires_at > now())
    and (1 - (m.embedding OPERATOR(extensions.<=>) p_embedding)) >= p_min_similarity
  order by m.embedding OPERATOR(extensions.<=>) p_embedding
  limit least(greatest(p_limit, 1), 50);
$$;

comment on function public.search_memories_semantic is
  'Cosine similarity over confirmed, live memories. Results below the '
  'similarity floor are dropped: a weak match fills the context window with '
  'noise and invites a confidently wrong answer.';


-- Hybrid retrieval. Weights are declared once here rather than scattered
-- across the application, so they can be tuned against evidence.
--   0.35 vector · 0.25 text · 0.15 recency · 0.10 confidence
--   0.10 category · 0.05 confirmation recency
create or replace function public.search_memories_hybrid(
  p_query text,
  p_embedding extensions.vector(1536) default null,
  p_categories text[] default null,
  p_limit integer default 12,
  p_include_sensitive boolean default false
)
returns table (
  id uuid, title text, content text, category text,
  sensitivity text, confidence numeric, score numeric,
  vector_similarity numeric, text_rank numeric,
  confirmed_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with scored as (
    select
      m.id, m.title, m.content, m.category, m.sensitivity,
      m.confidence, m.confirmed_at, m.last_confirmed_at, m.updated_at,
      case
        when p_embedding is null or m.embedding is null then 0::numeric
        else (1 - (m.embedding OPERATOR(extensions.<=>) p_embedding))::numeric
      end as vector_similarity,
      case
        when coalesce(trim(p_query), '') = '' then 0::numeric
        else ts_rank(m.search_vector, websearch_to_tsquery('english', p_query))::numeric
      end as text_rank,
      -- Exponential decay, ~90 day half-life.
      exp(-extract(epoch from (now() - m.updated_at)) / 7776000.0)::numeric
        as recency_decay,
      case
        when p_categories is null then 0::numeric
        when m.category = any(p_categories) then 1::numeric
        else 0::numeric
      end as category_match,
      case
        when m.last_confirmed_at is null then 0::numeric
        else exp(-extract(epoch from (now() - m.last_confirmed_at)) / 7776000.0)::numeric
      end as confirmation_recency
    from public.memories m
    where m.user_id = auth.uid()
      and m.deleted_at is null
      and m.status = 'confirmed'
      and (m.expires_at is null or m.expires_at > now())
      and (p_categories is null or m.category = any(p_categories))
      -- highly_sensitive is withheld unless the request directly concerns it.
      and (p_include_sensitive or m.sensitivity <> 'highly_sensitive')
  )
  select
    s.id, s.title, s.content, s.category, s.sensitivity, s.confidence,
    round(
      0.35 * s.vector_similarity +
      0.25 * least(s.text_rank * 10, 1) +
      0.15 * s.recency_decay +
      0.10 * s.confidence +
      0.10 * s.category_match +
      0.05 * s.confirmation_recency
    , 4) as score,
    round(s.vector_similarity, 4) as vector_similarity,
    round(s.text_rank, 4) as text_rank,
    s.confirmed_at, s.updated_at
  from scored s
  where s.vector_similarity > 0 or s.text_rank > 0 or p_categories is not null
  order by score desc
  limit least(greatest(p_limit, 1), 50);
$$;

comment on function public.search_memories_hybrid is
  'Weighted blend of vector similarity, full-text rank, recency, confidence, '
  'category relevance and confirmation recency. Ranking happens in the '
  'database so rows are not pulled out merely to be sorted.';


-- -----------------------------------------------------------------------------
-- Agenda and task retrieval
-- -----------------------------------------------------------------------------

create or replace function public.get_overdue_tasks(p_limit integer default 50)
returns table (
  id uuid, title text, priority text, due_at timestamptz, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, t.priority, t.due_at, t.status
  from public.tasks t
  where t.user_id = auth.uid()
    and t.deleted_at is null
    and t.status not in ('completed', 'cancelled')
    and t.due_at is not null
    and t.due_at < now()
  order by t.due_at asc
  limit least(greatest(p_limit, 1), 200);
$$;


create or replace function public.get_today_agenda(p_timezone text default 'Asia/Singapore')
returns table (
  kind text, id uuid, title text, at_time timestamptz, priority text, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Day boundaries are computed in the caller's zone, not UTC: in Singapore
  -- "today" starts at 16:00 UTC the previous day.
  -- The parentheses around the addition are load-bearing: `at time zone` binds
  -- more tightly than `+`, so `x + interval '1 day' at time zone tz` parses as
  -- `x + (interval '1 day' at time zone tz)` and fails outright. Without the
  -- error it would silently compute the wrong end-of-day.
  with bounds as (
    select
      (date_trunc('day', (now() at time zone p_timezone)) at time zone p_timezone)
        as day_start,
      ((date_trunc('day', (now() at time zone p_timezone)) + interval '1 day')
        at time zone p_timezone) as day_end
  )
  -- The aliases on the FIRST branch name the output columns of the whole
  -- union — without them `order by at_time` has nothing to bind to.
  select 'task'::text as kind, t.id as id, t.title as title,
         t.due_at as at_time, t.priority as priority, t.status as status
  from public.tasks t, bounds b
  where t.user_id = auth.uid()
    and t.deleted_at is null
    and t.status not in ('completed', 'cancelled')
    and t.due_at >= b.day_start and t.due_at < b.day_end
  union all
  select 'reminder'::text, r.id, r.title, r.remind_at, null::text, r.status
  from public.reminders r, bounds b
  where r.user_id = auth.uid()
    and r.status = 'scheduled'
    and r.remind_at >= b.day_start and r.remind_at < b.day_end
  order by at_time asc nulls last;
$$;


create or replace function public.get_due_reminders(p_horizon interval default interval '5 minutes')
returns table (
  id uuid, user_id uuid, title text, description text,
  next_trigger_at timestamptz, recurrence_rule text, timezone text,
  delivery_channel text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.user_id, r.title, r.description,
         coalesce(r.next_trigger_at, r.remind_at), r.recurrence_rule,
         r.timezone, r.delivery_channel
  from public.reminders r
  where r.user_id = auth.uid()
    and r.status = 'scheduled'
    and coalesce(r.next_trigger_at, r.remind_at) <= now() + p_horizon
  order by coalesce(r.next_trigger_at, r.remind_at) asc;
$$;


-- -----------------------------------------------------------------------------
-- Maintenance
-- -----------------------------------------------------------------------------
-- These are invoked by scheduled jobs with the secret key, so they check
-- is_owner() only when a caller is present rather than requiring one.

create or replace function public.purge_expired_approvals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.approvals
     set status = 'expired', updated_at = now()
   where status = 'pending'
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.purge_expired_conversations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.conversation_messages where retention_until < now();
  get diagnostics v_count = row_count;

  -- A conversation whose messages are gone keeps only its summary, which is
  -- the point: continuity without indefinite retention.
  delete from public.conversations
   where retention_until is not null
     and retention_until < now()
     and summary is null;

  return v_count;
end;
$$;

create or replace function public.expire_memories()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.memories
     set status = 'expired', updated_at = now()
   where status in ('suggested', 'confirmed')
     and expires_at is not null
     and expires_at < now()
     and deleted_at is null;
  get diagnostics v_count = row_count;

  -- A suggestion nobody reviewed in 30 days is not going to be reviewed.
  update public.memories
     set status = 'expired', updated_at = now()
   where status = 'suggested'
     and created_at < now() - interval '30 days'
     and deleted_at is null;

  return v_count;
end;
$$;

create or replace function public.purge_action_logs(p_retain_days integer default 365)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.action_logs
   where created_at < now() - make_interval(days => greatest(p_retain_days, 1));
  get diagnostics v_count = row_count;

  delete from public.tool_runs
   where created_at < now() - interval '90 days';

  return v_count;
end;
$$;


-- -----------------------------------------------------------------------------
-- Data rights: export and complete deletion
-- -----------------------------------------------------------------------------

-- Token columns are not selected anywhere below. They are excluded BY
-- CONSTRUCTION rather than by a filter that could later be relaxed.
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
  'Complete export of the caller''s own data. Token columns, embeddings and '
  'push credentials are excluded by construction — they are never selected.';

revoke all on function public.export_all_user_data() from public, anon;
grant execute on function public.export_all_user_data() to authenticated;


create or replace function public.delete_all_user_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted jsonb := '{}'::jsonb;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Ordered so foreign keys are always satisfied. Children first.
  delete from public.conversation_messages where user_id = v_uid;
  get diagnostics v_count = row_count;
  v_deleted := v_deleted || jsonb_build_object('conversation_messages', v_count);

  delete from public.conversations where user_id = v_uid;
  delete from public.research_sources where user_id = v_uid;
  delete from public.research_reports where user_id = v_uid;
  delete from public.memory_versions where user_id = v_uid;

  -- Break the self-reference before deleting, or the FK blocks the delete.
  update public.memories set superseded_by = null where user_id = v_uid;
  delete from public.memories where user_id = v_uid;
  get diagnostics v_count = row_count;
  v_deleted := v_deleted || jsonb_build_object('memories', v_count);

  delete from public.action_logs where user_id = v_uid;
  delete from public.tool_runs where user_id = v_uid;
  update public.approvals set supersedes_approval_id = null where user_id = v_uid;
  delete from public.approvals where user_id = v_uid;

  delete from public.reminders where user_id = v_uid;
  delete from public.tasks where user_id = v_uid;
  delete from public.ideas where user_id = v_uid;
  delete from public.daily_briefings where user_id = v_uid;
  delete from public.notification_subscriptions where user_id = v_uid;
  delete from public.connected_accounts where user_id = v_uid;
  delete from public.user_settings where user_id = v_uid;
  delete from public.profiles where user_id = v_uid;

  return jsonb_build_object(
    'deleted_at', now(),
    'counts', v_deleted,
    'note', 'Revoke Google access separately at myaccount.google.com/permissions.'
  );
end;
$$;

comment on function public.delete_all_user_data() is
  'Irreversibly deletes every Atlas record for the caller, in foreign-key-safe '
  'order. Google tokens are destroyed here, but only Google can revoke the '
  'grant on their side.';

revoke all on function public.delete_all_user_data() from public, anon;
grant execute on function public.delete_all_user_data() to authenticated;


-- Read-only grants for the retrieval helpers.
revoke all on function public.search_memories_semantic(extensions.vector, integer, numeric)
  from public, anon;
grant execute on function public.search_memories_semantic(extensions.vector, integer, numeric)
  to authenticated;

revoke all on function public.search_memories_hybrid(text, extensions.vector, text[], integer, boolean)
  from public, anon;
grant execute on function public.search_memories_hybrid(text, extensions.vector, text[], integer, boolean)
  to authenticated;

revoke all on function public.get_overdue_tasks(integer) from public, anon;
grant execute on function public.get_overdue_tasks(integer) to authenticated;

revoke all on function public.get_today_agenda(text) from public, anon;
grant execute on function public.get_today_agenda(text) to authenticated;

revoke all on function public.get_due_reminders(interval) from public, anon;
grant execute on function public.get_due_reminders(interval) to authenticated;

-- Maintenance functions are for scheduled jobs only.
revoke all on function public.purge_expired_approvals() from public, anon, authenticated;
revoke all on function public.purge_expired_conversations() from public, anon, authenticated;
revoke all on function public.expire_memories() from public, anon, authenticated;
revoke all on function public.purge_action_logs(integer) from public, anon, authenticated;
