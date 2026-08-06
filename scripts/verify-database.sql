-- =============================================================================
-- Database verification — paste into the Supabase SQL Editor and run.
-- =============================================================================
--
-- Checks that migrations applied, security is on, and the owner allowlist is
-- seeded. Read-only: it changes nothing.
--
-- Every row should read PASS. Anything else is explained in TROUBLESHOOTING.md.
-- Output contains no secrets, so it is safe to share.
-- =============================================================================

-- Reading a table that may not exist needs dynamic SQL: PostgreSQL plans the
-- whole statement up front, so even an unreachable branch of a CASE fails to
-- parse when the relation is absent. `pg_temp` keeps this function session-
-- local — it disappears when you close the editor and leaves nothing behind.
create or replace function pg_temp.allowlist_count()
returns integer
language plpgsql
as $fn$
declare
  n integer;
begin
  if to_regclass('private.allowed_users') is null then
    return -1;                        -- table missing: migrations not applied
  end if;
  execute 'select count(*)::int from private.allowed_users where enabled' into n;
  return n;
end;
$fn$;

with

-- 1. Every table the schema defines must exist.
expected_tables(name) as (
  values ('profiles'), ('user_settings'), ('connected_accounts'), ('memories'),
         ('memory_versions'), ('tasks'), ('reminders'), ('ideas'), ('approvals'),
         ('action_logs'), ('tool_runs'), ('conversations'),
         ('conversation_messages'), ('research_reports'), ('research_sources'),
         ('daily_briefings'), ('notification_subscriptions')
),
table_check as (
  select
    '1. Tables exist' as check,
    case when count(*) filter (where c.relname is null) = 0
      then 'PASS' else 'FAIL' end as result,
    case when count(*) filter (where c.relname is null) = 0
      then count(*)::text || ' of 17 present'
      else 'MISSING: ' || string_agg(e.name, ', ') filter (where c.relname is null)
    end as detail
  from expected_tables e
  left join pg_class c
    on c.relname = e.name
   and c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r'
),

-- 2. Row Level Security must be ON for every one of them.
--    This is the check that matters most: a table without RLS is readable by
--    anyone holding the publishable key, which ships in the browser.
rls_check as (
  select
    '2. RLS enabled everywhere' as check,
    case when count(*) filter (where not c.relrowsecurity) = 0
      then 'PASS' else 'FAIL' end as result,
    case when count(*) filter (where not c.relrowsecurity) = 0
      then 'all ' || count(*)::text || ' tables protected'
      else 'RLS OFF: ' || string_agg(c.relname, ', ') filter (where not c.relrowsecurity)
    end as detail
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind = 'r'
    and c.relname in (select name from expected_tables)
),

-- 3. RLS with no policies denies everything — safe, but it means the app
--    cannot read its own data. Both failure directions are worth catching.
policy_check as (
  select
    '3. Every table has policies' as check,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
    case when count(*) = 0
      then 'all tables carry at least one policy'
      else 'NO POLICIES: ' || string_agg(t.name, ', ')
    end as detail
  from expected_tables t
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.name
  )
),

-- 4. No policy may grant the anonymous role.
anon_check as (
  select
    '4. No anonymous grants' as check,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
    case when count(*) = 0
      then 'no policy targets anon'
      else 'ANON ACCESS: ' || string_agg(tablename || '.' || policyname, ', ')
    end as detail
  from pg_policies
  where schemaname = 'public' and 'anon' = any(roles)
),

-- 5. The allowlist is what makes this application yours. Empty means nobody
--    can sign in; more than one means someone else can.
-- Counted through a function so a MISSING table reports FAIL instead of
-- aborting the whole query. A verification script that dies on the first
-- problem cannot tell you about the other eight.
owner_check as (
  select
    '5. Owner allowlist' as check,
    case when n = 1 then 'PASS' else 'FAIL' end as result,
    case
      when n < 0 then 'TABLE MISSING — migrations have not been applied'
      when n = 0 then 'EMPTY — nobody can sign in, including you'
      when n = 1 then 'exactly one enabled owner, as it should be'
      else n::text || ' enabled entries — a private app should have ONE'
    end as detail
  from (select pg_temp.allowlist_count() as n) t
),

-- 6. Without claim_approval there is no atomic guard against an action
--    executing twice.
function_check as (
  select
    '6. Security functions' as check,
    case when count(*) >= 4 then 'PASS' else 'FAIL' end as result,
    count(*)::text || ' of 4 core functions present' as detail
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('claim_approval', 'is_owner',
                    'search_memories_hybrid', 'delete_all_user_data')
),

-- 7. A security-definer function without a pinned search_path can be hijacked
--    by a shadowing object in a user-controlled schema.
search_path_check as (
  select
    '7. search_path pinned' as check,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
    case when count(*) = 0
      then 'every security-definer function pins search_path'
      else 'UNPINNED: ' || string_agg(proname, ', ')
    end as detail
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and prosecdef
    and not exists (
      select 1 from unnest(coalesce(proconfig, '{}')) cfg
      where cfg like 'search_path=%'
    )
),

-- 7b. The private schema is hidden from the Data API, so it is reached only
--     through these public wrappers. Without them the owner cannot sign in and
--     scheduled jobs cannot claim work.
rpc_check as (
  select
    '7b. private-schema RPC' as check,
    case when count(*) = 5 then 'PASS' else 'FAIL' end as result,
    case when count(*) = 5
      then 'all 5 wrappers present'
      else count(*)::text || ' of 5 — apply migration 0011, or sign-in fails'
    end as detail
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('owner_allowlist_check', 'owner_allowlist_upsert',
                    'owner_allowlist_list', 'job_claim', 'job_finish')
),

-- 8. pgvector must be present or semantic memory silently degrades.
extension_check as (
  select
    '8. Extensions' as check,
    case when count(*) filter (where extname = 'vector') = 1
      then 'PASS' else 'FAIL' end as result,
    coalesce(string_agg(extname, ', ' order by extname), 'none') as detail
  from pg_extension
  where extname in ('vector', 'pgcrypto', 'citext', 'pg_cron', 'pg_net')
),

-- 9. The private schema must not be reachable through the Data API.
private_check as (
  select
    '9. private schema hidden' as check,
    case when count(*) = 0 then 'PASS' else 'REVIEW' end as result,
    case when count(*) = 0
      then 'no anon/authenticated grants on private'
      else 'grants exist — confirm private is NOT in Exposed schemas'
    end as detail
  from information_schema.role_table_grants
  where table_schema = 'private' and grantee in ('anon', 'authenticated')
)

select * from table_check
union all select * from rls_check
union all select * from policy_check
union all select * from anon_check
union all select * from owner_check
union all select * from function_check
union all select * from search_path_check
union all select * from rpc_check
union all select * from extension_check
union all select * from private_check;
