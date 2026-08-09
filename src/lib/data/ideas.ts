import 'server-only';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import type { Idea, IdeaStatus, Json } from '@/types/database';

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

export type CaptureIdeaInput = {
  title: string;
  capture: string;
  summary?: string;
  category?: string;
  nextAction?: string;
  structuredPlan?: Json;
};

export async function captureIdea(input: CaptureIdeaInput): Promise<Idea> {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in.');

  // Gemini Live may repeat a function call after reconnecting. Preserve the
  // first capture and return it instead of creating a duplicate card.
  const { data: existing, error: existingError } = await supabase
    .from('ideas')
    .select('*')
    .eq('user_id', auth.user.id)
    .eq('original_capture', input.capture)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Could not check existing ideas (${existingError.code ?? 'unknown'})`);
  }
  if (existing) return existing as Idea;

  const { data, error } = await supabase
    .from('ideas')
    .insert({
      user_id: auth.user.id,
      title: input.title,
      // Verbatim. Never normalised, trimmed of meaning, or "improved".
      original_capture: input.capture,
      summary: input.summary,
      category: input.category,
      status: 'captured',
      next_action: input.nextAction,
      structured_plan: input.structuredPlan ?? {},
    })
    .select()
    .single();

  if (error) throw new Error(`Could not capture the idea (${error.code ?? 'unknown'})`);
  revalidatePath('/ideas');
  return data as Idea;
}

export async function updateIdeaStatus(id: string, status: IdeaStatus): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('ideas').update({ status }).eq('id', id);
  if (error) throw new Error(`Could not update the idea (${error.code ?? 'unknown'})`);
}
