import 'server-only';

import { canonicalLearningKey, isUnsafeLearningContent, lifecycleFor, reinforceConfidence } from '@/lib/atlas/learning/engine';
import { createClient } from '@/lib/supabase/server';
import type { AtlasAdaptation, EvolutionProposal, LearningCategory, LearningItem, SystemMetric } from '@/types/database';

type Evidence = { at: string; source: string; reference?: string };

export type LearningObservation = {
  userId: string;
  kind?: LearningItem['kind'];
  category: LearningCategory;
  key: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceReference?: string;
  explicit?: boolean;
  metadata?: Record<string, string | number | boolean | string[]>;
};

/** Record or reinforce one meaningful signal. Never called for page views/clicks. */
export async function recordLearningObservation(input: LearningObservation): Promise<LearningItem | null> {
  if (isUnsafeLearningContent(`${input.title}\n${input.summary}`)) return null;

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from('user_settings')
    .select('learning_enabled,learning_paused_until')
    .maybeSingle();
  if (settings?.learning_enabled === false) return null;
  if (settings?.learning_paused_until && Date.parse(settings.learning_paused_until) > Date.now()) return null;

  const kind = input.kind ?? (input.explicit ? 'confirmed_memory' : 'observation');
  const canonicalKey = canonicalLearningKey(input.key);
  if (!canonicalKey) return null;
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('learning_items')
    .select('*')
    .eq('kind', kind)
    .eq('canonical_key', canonicalKey)
    .maybeSingle();
  const evidence: Evidence = { at: now, source: input.sourceType, reference: input.sourceReference };

  if (existing) {
    const row = existing as LearningItem;
    const evidenceCount = row.evidence_count + 1;
    const confidence = input.explicit ? 1 : reinforceConfidence(row.confidence, 'normal', true);
    const priorEvidence = Array.isArray(row.evidence) ? row.evidence : [];
    const { data } = await supabase
      .from('learning_items')
      .update({
        summary: input.summary,
        confidence,
        evidence_count: evidenceCount,
        evidence: [...priorEvidence, evidence].slice(-12),
        last_reinforced_at: now,
        user_confirmed: row.user_confirmed || Boolean(input.explicit),
        status: lifecycleFor({ confidence, evidenceCount, userConfirmed: row.user_confirmed || Boolean(input.explicit), kind }),
        metadata: input.metadata ?? row.metadata,
      })
      .eq('id', row.id)
      .select('*')
      .single();
    return (data as LearningItem | null) ?? null;
  }

  const confidence = input.explicit ? 1 : 0.3;
  const { data } = await supabase
    .from('learning_items')
    .insert({
      user_id: input.userId,
      kind,
      category: input.category,
      canonical_key: canonicalKey,
      title: input.title,
      summary: input.summary,
      status: lifecycleFor({ confidence, evidenceCount: 1, userConfirmed: input.explicit, kind }),
      confidence,
      evidence: [evidence],
      evidence_count: 1,
      source_type: input.sourceType,
      source_reference: input.sourceReference ?? null,
      user_confirmed: Boolean(input.explicit),
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  return (data as LearningItem | null) ?? null;
}

/** Tool-name-only workflow learning: useful structure without retaining payloads. */
export async function observeToolOutcome(userId: string, toolName: string, succeeded: boolean): Promise<void> {
  if (!succeeded) return;
  const category: LearningCategory = toolName.startsWith('research.') ? 'research' : 'productivity';
  await recordLearningObservation({
    userId,
    category,
    key: `uses:${toolName}`,
    title: `Uses ${toolName.replace('.', ' ')}`,
    summary: `Atlas has observed successful use of ${toolName}.`,
    sourceType: 'tool_usage',
    sourceReference: toolName,
  });

  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: settings } = await supabase.from('user_settings').select('workflow_learning_enabled').maybeSingle();
  if (settings?.workflow_learning_enabled === false) return;
  const { data: recent } = await supabase
    .from('action_logs')
    .select('tool_name')
    .eq('status', 'success')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(3);
  const steps = [...(recent ?? []).map((row) => row.tool_name as string).reverse(), toolName]
    .filter((name, index, all) => index === 0 || name !== all[index - 1])
    .slice(-3);
  if (steps.length < 2) return;
  await recordLearningObservation({
    userId,
    kind: 'workflow',
    category: 'workflows',
    key: `workflow:${steps.join('>')}`,
    title: steps.map((step) => step.split('.')[0]).join(' → '),
    summary: `A repeated sequence may be emerging: ${steps.join(' → ')}.`,
    sourceType: 'tool_usage',
    metadata: { steps },
  });
}

export async function getEvolutionDashboard() {
  const supabase = await createClient();
  const [items, adaptations, metrics, proposals] = await Promise.all([
    supabase.from('learning_items').select('*').is('deleted_at', null).not('status', 'in', '(dismissed,retired,superseded)').order('updated_at', { ascending: false }).limit(60),
    supabase.from('atlas_adaptations').select('*').order('updated_at', { ascending: false }).limit(30),
    supabase.from('system_metrics').select('*').order('recorded_at', { ascending: false }).limit(40),
    supabase.from('evolution_proposals').select('*').eq('status', 'open').order('confidence', { ascending: false }).limit(20),
  ]);
  return {
    items: (items.data ?? []) as LearningItem[],
    adaptations: (adaptations.data ?? []) as AtlasAdaptation[],
    metrics: (metrics.data ?? []) as SystemMetric[],
    proposals: (proposals.data ?? []) as EvolutionProposal[],
  };
}

export async function getRelevantLearningContext(query: string, limit = 6): Promise<LearningItem[]> {
  const supabase = await createClient();
  const safeQuery = query.replace(/[%_,()]/g, ' ').trim().slice(0, 160);
  if (!safeQuery) return [];
  const { data } = await supabase
    .from('learning_items')
    .select('*')
    .in('status', ['confirmed', 'active'])
    .is('deleted_at', null)
    .or(`title.ilike.%${safeQuery}%,summary.ilike.%${safeQuery}%`)
    .order('confidence', { ascending: false })
    .limit(Math.min(limit, 10));
  return (data ?? []) as LearningItem[];
}

export async function getActiveBehavioralContext(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('atlas_adaptations')
    .select('description,value')
    .eq('status', 'active')
    .eq('category', 'behavioral')
    .eq('risk_level', 'low')
    .limit(5);
  return (data ?? []).map((row) => row.description as string).slice(0, 5);
}
