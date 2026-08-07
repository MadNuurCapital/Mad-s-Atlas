import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { DailyBriefing } from '@/types/database';

export async function getLatestBriefing(): Promise<DailyBriefing | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_briefings')
    .select('*')
    .order('briefing_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as DailyBriefing | null) ?? null;
}
