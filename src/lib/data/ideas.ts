import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Idea, IdeaStatus } from '@/types/database';

/**
 * Idea capture.
 *
 * `original_capture` is written once and never rewritten. Atlas may summarise
 * it, plan from it, or turn it into a brief — but the exact words Muhammad
 * used stay intact, because a summary discards the detail that made the idea
 * worth capturing.
 */

export const IDEA_PIPELINE: IdeaStatus[] = [
  'captured',
  'exploring',
  'planned',
  'building',
  'completed',
  'parked',
];

export async function listIdeas(): Promise<Idea[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .is('archived_at', null)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Could not load ideas (${error.code ?? 'unknown'})`);
  return (data ?? []) as Idea[];
}

export function groupIdeasByStatus(ideas: Idea[]): Record<IdeaStatus, Idea[]> {
  const grouped = Object.fromEntries(IDEA_PIPELINE.map((s) => [s, [] as Idea[]])) as Record<
    IdeaStatus,
    Idea[]
  >;

  for (const idea of ideas) {
    const bucket = grouped[idea.status];
    if (bucket) bucket.push(idea);
  }

  return grouped;
}

export async function captureIdea(input: { title: string; capture: string }): Promise<Idea> {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('ideas')
    .insert({
      user_id: auth.user.id,
      title: input.title,
      // Verbatim. Never normalised, trimmed of meaning, or "improved".
      original_capture: input.capture,
      status: 'captured',
    })
    .select()
    .single();

  if (error) throw new Error(`Could not capture the idea (${error.code ?? 'unknown'})`);
  return data as Idea;
}

export async function updateIdeaStatus(id: string, status: IdeaStatus): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('ideas').update({ status }).eq('id', id);
  if (error) throw new Error(`Could not update the idea (${error.code ?? 'unknown'})`);
}
