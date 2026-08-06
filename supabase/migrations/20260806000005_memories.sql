-- =============================================================================
-- 0005 — Memory and memory versions
-- =============================================================================
--
-- Purpose:
--   Curated personal memory with full-text and semantic search, and a
--   recoverable version history.
--
-- Rollback:
--   drop trigger if exists memories_version_on_update on public.memories;
--   drop function if exists private.record_memory_version();
--   drop table if exists public.memory_versions;
--   drop table if exists public.memories;
--   -- Destroys all remembered information and its history.
--
-- =============================================================================

create table if not exists public.memories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  content         text not null,
  category        text not null,
  structured_data jsonb not null default '{}'::jsonb,
  status          text not null default 'suggested',
  confidence      numeric(3,2) not null default 0.50,
  sensitivity     text not null default 'normal',
  source_type     text not null default 'manual',
  source_reference text,

  confirmed_at      timestamptz,
  last_confirmed_at timestamptz,
  expires_at        timestamptz,
  superseded_by     uuid references public.memories(id) on delete set null,

  -- 1536, not the model's default 3072: pgvector cannot build an HNSW or
  -- IVFFlat index on a vector wider than 2000 dimensions, and an unindexed
  -- column means a sequential scan on every semantic search. Matryoshka
  -- truncation keeps the quality and keeps the index.
  embedding      extensions.vector(1536),
  embedding_attempts integer not null default 0,

  search_vector  tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint memories_category_check check (category in (
    'profile', 'preference', 'goal', 'routine', 'important_person',
    'project', 'commitment', 'decision', 'idea_reference', 'temporary_context'
  )),
  constraint memories_status_check check (status in (
    'suggested', 'confirmed', 'superseded', 'expired', 'deleted'
  )),
  constraint memories_sensitivity_check check (sensitivity in (
    'normal', 'personal', 'sensitive', 'highly_sensitive'
  )),
  constraint memories_source_check check (source_type in (
    'voice', 'text', 'email', 'calendar', 'research', 'manual', 'system'
  )),
  constraint memories_confidence_check check (confidence >= 0 and confidence <= 1),
  -- temporary_context without an expiry is not temporary.
  constraint memories_temporary_needs_expiry check (
    category <> 'temporary_context' or expires_at is not null
  ),
  constraint memories_confirmed_has_timestamp check (
    status <> 'confirmed' or confirmed_at is not null
  )
);

comment on table public.memories is
  'Curated personal memory. Only status = ''confirmed'' rows inform answers; '
  'suggestions are shown for review and never treated as fact.';
comment on column public.memories.embedding is
  'vector(1536) via Matryoshka truncation of gemini-embedding-001. Nullable: '
  'generated asynchronously, and a failed embedding must never block a save.';
comment on column public.memories.embedding_attempts is
  'Backfill retry counter. Bounded so a permanently failing row is flagged '
  'rather than retried forever.';
comment on column public.memories.sensitivity is
  'highly_sensitive rows are excluded from proactive output and from prompts '
  'unless the request directly concerns them.';
comment on column public.memories.superseded_by is
  'Points at the memory that replaced this one. Both rows are retained.';

-- Full-text
create index if not exists memories_search_idx
  on public.memories using gin (search_vector);

-- Semantic. Partial: only confirmed, live rows are ever searched this way,
-- which keeps the index small and the recall honest.
create index if not exists memories_embedding_idx
  on public.memories using hnsw (embedding extensions.vector_cosine_ops)
  where deleted_at is null and status = 'confirmed';

create index if not exists memories_lookup_idx
  on public.memories (user_id, status, category)
  where deleted_at is null;

create index if not exists memories_expiry_idx
  on public.memories (expires_at)
  where expires_at is not null and deleted_at is null and status <> 'expired';

-- Backfill queue for the embedding job.
create index if not exists memories_pending_embedding_idx
  on public.memories (user_id, created_at)
  where embedding is null and deleted_at is null and embedding_attempts < 5;

create index if not exists memories_suggested_idx
  on public.memories (user_id, created_at desc)
  where status = 'suggested' and deleted_at is null;


-- -----------------------------------------------------------------------------
-- Version history
-- -----------------------------------------------------------------------------

create table if not exists public.memory_versions (
  id                       uuid primary key default gen_random_uuid(),
  memory_id                uuid not null references public.memories(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  previous_content         text not null,
  previous_structured_data jsonb not null default '{}'::jsonb,
  change_reason            text,
  changed_by               text not null default 'user',
  created_at               timestamptz not null default now(),

  constraint memory_versions_changed_by_check check (changed_by in ('user', 'atlas'))
);

comment on table public.memory_versions is
  'Prior content of every edited memory. Written by trigger, never by the '
  'application, so an edit cannot skip the audit trail.';

create index if not exists memory_versions_memory_idx
  on public.memory_versions (memory_id, created_at desc);


create or replace function private.record_memory_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only record when the substance changed. Status transitions and embedding
  -- backfills would otherwise flood the history with noise.
  if old.content is distinct from new.content
     or old.structured_data is distinct from new.structured_data then
    insert into public.memory_versions (
      memory_id, user_id, previous_content, previous_structured_data,
      change_reason, changed_by
    )
    values (
      old.id, old.user_id, old.content, old.structured_data,
      case
        when new.status = 'superseded' then 'superseded'
        when new.deleted_at is not null then 'deleted'
        else 'edited'
      end,
      'user'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists memories_version_on_update on public.memories;
create trigger memories_version_on_update
  before update on public.memories
  for each row execute function private.record_memory_version();

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at
  before update on public.memories
  for each row execute function private.set_updated_at();
