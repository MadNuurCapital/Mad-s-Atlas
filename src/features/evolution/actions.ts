'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireOwner } from '@/lib/auth/owner';
import { reinforceConfidence } from '@/lib/atlas/learning/engine';
import { logAction } from '@/lib/data/action-log';
import { createClient } from '@/lib/supabase/server';
import type { LearningItem } from '@/types/database';

export type EvolutionActionResult = { ok: true } | { ok: false; error: string };
const idSchema = z.uuid();

export async function reviewLearningItem(id: string, feedback: 'useful' | 'not_useful' | 'confirm' | 'dismiss'): Promise<EvolutionActionResult> {
  const { user } = await requireOwner();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'That learning item was not valid.' };
  const supabase = await createClient();
  const { data: item } = await supabase.from('learning_items').select('*').eq('id', parsed.data).maybeSingle();
  if (!item) return { ok: false, error: 'That learning item no longer exists.' };
  const changes: Partial<LearningItem> = feedback === 'confirm'
    ? { user_confirmed: true, status: item.kind === 'workflow' ? 'active' : 'confirmed', confidence: 1 }
    : feedback === 'dismiss'
      ? { status: 'dismissed', feedback_score: item.feedback_score - 1 }
      : { confidence: feedback === 'useful' ? reinforceConfidence(item.confidence, 'strong') : Math.max(0, item.confidence - 0.2), feedback_score: item.feedback_score + (feedback === 'useful' ? 1 : -1) };
  const { error } = await supabase.from('learning_items').update(changes).eq('id', parsed.data);
  if (error) return { ok: false, error: 'Atlas could not save that feedback.' };
  await supabase.from('learning_feedback').insert({ user_id: user.id, learning_item_id: parsed.data, feedback_type: feedback, source: 'ui' });
  await logAction({ toolName: 'learning.feedback', operationType: 'execute', actionSummary: 'Reviewed a learned pattern', status: 'success', metadata: { feedback } });
  revalidatePath('/evolution');
  return { ok: true };
}

export async function revertAdaptation(id: string): Promise<EvolutionActionResult> {
  await requireOwner();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'That adaptation was not valid.' };
  const supabase = await createClient();
  const { error } = await supabase.from('atlas_adaptations').update({ status: 'reverted', reverted_at: new Date().toISOString() }).eq('id', parsed.data).eq('risk_level', 'low');
  if (error) return { ok: false, error: 'Atlas could not revert that adaptation.' };
  revalidatePath('/evolution');
  return { ok: true };
}

export async function resetInferredLearning(): Promise<EvolutionActionResult> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_learning_engine');
  if (error) return { ok: false, error: 'Atlas could not reset inferred learning.' };
  revalidatePath('/evolution');
  return { ok: true };
}
