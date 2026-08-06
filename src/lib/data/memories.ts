import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Memory, MemoryCategory, MemoryStatus, Sensitivity } from '@/types/database';

/**
 * Memory reads and writes.
 *
 * Two rules govern this module, both from MEMORY_SYSTEM.md:
 *
 *  1. Only `status = 'confirmed'` informs answers. Suggestions appear in the
 *     review queue and nowhere else — a suggestion presented as fact is the
 *     failure mode the whole four-layer design exists to prevent.
 *
 *  2. A save must never depend on an embedding. Embeddings are generated
 *     asynchronously; a provider outage must not lose what Muhammad said.
 */

export type MemoryFilters = {
  status?: MemoryStatus;
  category?: MemoryCategory;
  search?: string;
  limit?: number;
};

export async function listMemories(filters: MemoryFilters = {}): Promise<Memory[]> {
  const supabase = await createClient();

  let query = supabase
    .from('memories')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(Math.min(filters.limit ?? 100, 500));

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);

  if (filters.search?.trim()) {
    // Full-text over the generated tsvector. `websearch` accepts quoted
    // phrases and OR the way a person expects a search box to behave.
    query = query.textSearch('search_vector', filters.search.trim(), {
      type: 'websearch',
      config: 'english',
    });
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load memories (${error.code ?? 'unknown'})`);
  return (data ?? []) as Memory[];
}

export async function getMemory(id: string): Promise<Memory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('memories')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Could not load that memory (${error.code ?? 'unknown'})`);
  return (data as Memory | null) ?? null;
}

export type MemoryCounts = {
  confirmed: number;
  suggested: number;
  byCategory: Record<string, number>;
};

export async function countMemories(): Promise<MemoryCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('memories')
    .select('status,category')
    .is('deleted_at', null);

  if (error) return { confirmed: 0, suggested: 0, byCategory: {} };

  const counts: MemoryCounts = { confirmed: 0, suggested: 0, byCategory: {} };
  for (const row of data ?? []) {
    const status = row.status as MemoryStatus;
    const category = row.category as string;

    if (status === 'confirmed') {
      counts.confirmed += 1;
      counts.byCategory[category] = (counts.byCategory[category] ?? 0) + 1;
    } else if (status === 'suggested') {
      counts.suggested += 1;
    }
  }
  return counts;
}

/**
 * Hybrid retrieval for the orchestrator.
 *
 * Deliberately capped: the whole memory store is never injected into a prompt.
 * That would be slow, expensive, and would leak unrelated private information
 * into every request.
 */
export type RetrievedMemory = {
  id: string;
  title: string;
  content: string;
  category: MemoryCategory;
  sensitivity: Sensitivity;
  confidence: number;
  score: number;
  vector_similarity: number;
  text_rank: number;
};

export type RetrievalResult = {
  memories: RetrievedMemory[];
  /** True when vector search was unavailable and results are text-only. */
  degraded: boolean;
  degradedReason?: string;
};

export async function retrieveRelevantMemories(options: {
  query: string;
  embedding?: number[] | null;
  categories?: MemoryCategory[];
  limit?: number;
  includeSensitive?: boolean;
}): Promise<RetrievalResult> {
  const supabase = await createClient();

  const embeddingLiteral = options.embedding
    ? `[${options.embedding.join(',')}]`
    : null;

  const { data, error } = await supabase.rpc('search_memories_hybrid', {
    p_query: options.query,
    p_embedding: embeddingLiteral,
    p_categories: options.categories ?? null,
    p_limit: Math.min(options.limit ?? 12, 50),
    p_include_sensitive: options.includeSensitive ?? false,
  });

  if (error) {
    throw new Error(`Memory search failed (${error.code ?? 'unknown'})`);
  }

  return {
    memories: (data ?? []) as RetrievedMemory[],
    // Say so when the answer is text-only. Silently returning worse results as
    // though they were complete is what makes a system untrustworthy.
    degraded: embeddingLiteral === null,
    ...(embeddingLiteral === null
      ? { degradedReason: 'No embedding was available, so this used text search only.' }
      : {}),
  };
}

/** Memories awaiting review. Never used to inform an answer. */
export async function listSuggestedMemories(): Promise<Memory[]> {
  return listMemories({ status: 'suggested', limit: 100 });
}
