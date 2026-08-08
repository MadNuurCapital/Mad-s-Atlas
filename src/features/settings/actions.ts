'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireOwner } from '@/lib/auth/owner';
import { logAction } from '@/lib/data/action-log';
import { createClient } from '@/lib/supabase/server';
import type { UserSettings } from '@/types/database';

export type SettingsActionResult = { ok: true } | { ok: false; error: string };

const toggleSchema = z.boolean();

export async function setDailyBriefingEnabled(enabled: boolean): Promise<SettingsActionResult> {
  const { user, email } = await requireOwner();
  const parsed = toggleSchema.safeParse(enabled);
  if (!parsed.success) return { ok: false, error: 'That briefing setting was not valid.' };

  const supabase = await createClient();
  const [profileResult, settingsResult] = await Promise.all([
    supabase
      .from('profiles')
      .upsert(
        { user_id: user.id, email, briefing_enabled: parsed.data },
        { onConflict: 'user_id' },
      )
      .select('briefing_enabled')
      .single(),
    supabase
      .from('user_settings')
      .upsert(
        { user_id: user.id, proactive_briefings_enabled: parsed.data },
        { onConflict: 'user_id' },
      )
      .select('proactive_briefings_enabled')
      .single(),
  ]);

  if (
    profileResult.error ||
    settingsResult.error ||
    profileResult.data?.briefing_enabled !== parsed.data ||
    settingsResult.data?.proactive_briefings_enabled !== parsed.data
  ) {
    return { ok: false, error: 'Atlas could not update the daily briefing setting.' };
  }

  await logAction({
    toolName: 'settings.daily_briefing',
    operationType: 'execute',
    actionSummary: parsed.data ? 'Enabled daily briefing' : 'Disabled daily briefing',
    status: 'success',
  });

  revalidatePath('/settings');
  revalidatePath('/today');
  return { ok: true };
}

export async function setMemoryEnabled(enabled: boolean): Promise<SettingsActionResult> {
  const { user } = await requireOwner();
  const parsed = toggleSchema.safeParse(enabled);
  if (!parsed.success) return { ok: false, error: 'That memory setting was not valid.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_settings')
    .upsert(
      { user_id: user.id, memory_enabled: parsed.data },
      { onConflict: 'user_id' },
    )
    .select('memory_enabled')
    .single();

  if (error || data?.memory_enabled !== parsed.data) {
    return { ok: false, error: 'Atlas could not update the memory setting.' };
  }

  await logAction({
    toolName: 'settings.memory',
    operationType: 'execute',
    actionSummary: parsed.data ? 'Enabled Atlas memory' : 'Disabled Atlas memory',
    status: 'success',
  });

  revalidatePath('/settings');
  revalidatePath('/memory');
  return { ok: true };
}

type LearningToggle =
  | 'learning_enabled'
  | 'proactive_suggestions_enabled'
  | 'workflow_learning_enabled'
  | 'system_diagnostics_enabled'
  | 'automatic_adaptations_enabled';

async function setLearningToggle(field: LearningToggle, enabled: boolean): Promise<SettingsActionResult> {
  const { user } = await requireOwner();
  const parsed = toggleSchema.safeParse(enabled);
  if (!parsed.success) return { ok: false, error: 'That learning setting was not valid.' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_settings')
    .update({ [field]: parsed.data, ...(field === 'learning_enabled' && parsed.data ? { learning_paused_until: null } : {}) })
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error || (data as UserSettings | null)?.[field] !== parsed.data) {
    return { ok: false, error: 'Atlas could not save that learning setting.' };
  }
  await logAction({ toolName: `settings.${field}`, operationType: 'execute', actionSummary: `Updated ${field.replaceAll('_', ' ')}`, status: 'success' });
  revalidatePath('/settings');
  revalidatePath('/evolution');
  return { ok: true };
}

export async function setLearningEnabled(enabled: boolean) { return setLearningToggle('learning_enabled', enabled); }
export async function setProactiveSuggestionsEnabled(enabled: boolean) { return setLearningToggle('proactive_suggestions_enabled', enabled); }
export async function setWorkflowLearningEnabled(enabled: boolean) { return setLearningToggle('workflow_learning_enabled', enabled); }
export async function setSystemDiagnosticsEnabled(enabled: boolean) { return setLearningToggle('system_diagnostics_enabled', enabled); }
export async function setAutomaticAdaptationsEnabled(enabled: boolean) { return setLearningToggle('automatic_adaptations_enabled', enabled); }

export async function pauseLearningFor24Hours(): Promise<SettingsActionResult> {
  const { user } = await requireOwner();
  const until = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const supabase = await createClient();
  const { error } = await supabase.from('user_settings').update({ learning_paused_until: until }).eq('user_id', user.id);
  if (error) return { ok: false, error: 'Atlas could not pause learning.' };
  revalidatePath('/settings');
  return { ok: true };
}

const preferredNameSchema = z.string().trim().min(1).max(80);

export async function setPreferredName(name: string): Promise<SettingsActionResult> {
  const { user, email } = await requireOwner();
  const parsed = preferredNameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: 'Preferred name must be between 1 and 80 characters.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: user.id, email, preferred_name: parsed.data },
      { onConflict: 'user_id' },
    )
    .select('preferred_name')
    .single();

  if (error || data?.preferred_name !== parsed.data) {
    return { ok: false, error: 'Atlas could not save your preferred name.' };
  }

  await logAction({
    toolName: 'settings.preferred_name',
    operationType: 'execute',
    actionSummary: 'Updated preferred name',
    status: 'success',
  });

  revalidatePath('/settings');
  revalidatePath('/today');
  return { ok: true };
}
