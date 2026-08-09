import 'server-only';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import type {
  Idea,
  IdeaNote,
  IdeaStatus,
  IdeaStep,
  Json,
  Reminder,
  Task,
} from '@/types/database';

/**
 * Ideas are durable objects. `original_capture` is database-immutable; Atlas
 * may improve the understanding and plan without rewriting what the user said.
 */

export const IDEA_PIPELINE: IdeaStatus[] = [
  'captured',
  'planned',
  'in_progress',
  'completed',
  'archived',
];

export type IdeaDetail = {
  idea: Idea;
  steps: IdeaStep[];
  notes: IdeaNote[];
  tasks: Task[];
  reminders: Reminder[];
};

export async function listIdeas(): Promise<Idea[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .is('deleted_at', null)
    .order('last_touched_at', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Could not load ideas (${error.code ?? 'unknown'})`);
  return (data ?? []) as Idea[];
}

export async function getIdeaDetail(id: string): Promise<IdeaDetail | null> {
  const supabase = await createClient();
  const { data: idea, error } = await supabase
    .from('ideas')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(`Could not load the idea (${error.code ?? 'unknown'})`);
  if (!idea) return null;

  const [steps, notes, tasks, reminders] = await Promise.all([
    supabase.from('idea_steps').select('*').eq('idea_id', id).order('position'),
    supabase.from('idea_notes').select('*').eq('idea_id', id).order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('idea_id', id).is('deleted_at', null).order('created_at'),
    supabase.from('reminders').select('*').eq('idea_id', id).order('remind_at'),
  ]);

  const firstError = steps.error ?? notes.error ?? tasks.error ?? reminders.error;
  if (firstError) throw new Error(`Could not load the complete idea (${firstError.code ?? 'unknown'})`);

  return {
    idea: idea as Idea,
    steps: (steps.data ?? []) as IdeaStep[],
    notes: (notes.data ?? []) as IdeaNote[],
    tasks: (tasks.data ?? []) as Task[],
    reminders: (reminders.data ?? []) as Reminder[],
  };
}

export function groupIdeasByStatus(ideas: Idea[]): Record<IdeaStatus, Idea[]> {
  const grouped = Object.fromEntries(IDEA_PIPELINE.map((status) => [status, [] as Idea[]])) as Record<
    IdeaStatus,
    Idea[]
  >;

  for (const idea of ideas) grouped[idea.status].push(idea);
  return grouped;
}

export function isStaleIdea(idea: Idea, now = new Date(), staleDays = 90): boolean {
  if (idea.status === 'completed' || idea.status === 'archived' || idea.deleted_at) return false;
  return new Date(idea.last_touched_at).getTime() <= now.getTime() - staleDays * 86_400_000;
}

export async function getNextPlanAction(): Promise<{ idea: Idea; step: IdeaStep } | null> {
  const supabase = await createClient();
  const { data: ideas, error: ideasError } = await supabase
    .from('ideas')
    .select('*')
    .is('deleted_at', null)
    .in('status', ['planned', 'in_progress']);
  if (ideasError || !ideas?.length) return null;

  const byId = new Map((ideas as Idea[]).map((idea) => [idea.id, idea]));
  const { data: steps, error } = await supabase
    .from('idea_steps')
    .select('*')
    .in('idea_id', [...byId.keys()])
    .in('status', ['pending', 'in_progress'])
    .not('scheduled_start', 'is', null)
    .order('scheduled_start')
    .limit(1);

  if (error) return null;
  const step = steps?.[0] as IdeaStep | undefined;
  const idea = step ? byId.get(step.idea_id) : undefined;
  return step && idea ? { idea, step } : null;
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

  // Gemini Live may replay a function call after reconnecting. Exact capture
  // deduplication makes the operation idempotent without conflating similar ideas.
  const { data: existing, error: existingError } = await supabase
    .from('ideas')
    .select('*')
    .eq('user_id', auth.user.id)
    .eq('original_capture', input.capture)
    .is('deleted_at', null)
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
      original_capture: input.capture,
      summary: input.summary,
      category: input.category,
      status: 'captured',
      next_action: input.nextAction,
      structured_plan: input.structuredPlan ?? {},
      instructions: [],
      last_touched_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Could not capture the idea (${error.code ?? 'unknown'})`);
  revalidatePath('/ideas');
  return data as Idea;
}
