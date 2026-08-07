'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireOwner } from '@/lib/auth/owner';
import { logAction } from '@/lib/data/action-log';
import { createClient } from '@/lib/supabase/server';

export type SettingsActionResult = { ok: true } | { ok: false; error: string };

const toggleSchema = z.boolean();

export async function setDailyBriefingEnabled(enabled: boolean): Promise<SettingsActionResult> {
  const { user } = await requireOwner();
  const parsed = toggleSchema.safeParse(enabled);
  if (!parsed.success) return { ok: false, error: 'That briefing setting was not valid.' };

  const supabase = await createClient();
  const [profileResult, settingsResult] = await Promise.all([
    supabase
      .from('profiles')
      .update({ briefing_enabled: parsed.data })
      .eq('user_id', user.id),
    supabase
      .from('user_settings')
      .update({ proactive_briefings_enabled: parsed.data })
      .eq('user_id', user.id),
  ]);

  if (profileResult.error || settingsResult.error) {
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
  const { error } = await supabase
    .from('user_settings')
    .update({ memory_enabled: parsed.data })
    .eq('user_id', user.id);

  if (error) return { ok: false, error: 'Atlas could not update the memory setting.' };

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
