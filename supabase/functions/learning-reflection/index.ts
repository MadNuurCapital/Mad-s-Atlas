/**
 * Deterministic daily reflection / weekly consolidation.
 *
 * No AI call is made. It aggregates redacted action-log mechanics, updates
 * confidence/lifecycle, decays stale inferences, and emits reviewable
 * proposals for sustained degradation. It never executes proposal text.
 */

import { adminClient, claimRun, finishRun, isAuthorisedCaller, localDateKey } from '../_shared/job.ts';

type LogRow = { tool_name: string; status: string; duration_ms: number | null };

function metricHealth(name: string, value: number, samples: number): 'healthy' | 'watch' | 'degraded' {
  if (samples < 3) return 'watch';
  if (name === 'failure_rate') return value >= 0.2 ? 'degraded' : value >= 0.08 ? 'watch' : 'healthy';
  return value >= 8000 ? 'degraded' : value >= 3000 ? 'watch' : 'healthy';
}

Deno.serve(async (request: Request) => {
  if (!isAuthorisedCaller(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorised.' }), { status: 401 });
  }

  const startedAt = Date.now();
  const body = (await request.json().catch(() => ({}))) as { weekly?: boolean };
  const weekly = body.weekly === true;
  const supabase = adminClient();
  const { data: profiles, error: profilesError } = await supabase.from('profiles').select('user_id,timezone');
  if (profilesError) {
    return new Response(JSON.stringify({ error: 'Profile lookup failed.' }), { status: 500 });
  }
  const outcomes: Array<{ user: string; metrics: number; status: string }> = [];

  for (const profile of profiles ?? []) {
    const userId = profile.user_id as string;
    const timezone = (profile.timezone as string) ?? 'Asia/Singapore';
    const dateKey = localDateKey(new Date(), timezone);
    const runKey = `${weekly ? 'weekly' : 'daily'}:${userId}:${dateKey}`;
    const claim = await claimRun(supabase, 'learning_reflection', runKey);
    if (!claim.claimed) { outcomes.push({ user: userId, metrics: 0, status: 'already_running' }); continue; }

    try {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('learning_enabled,learning_paused_until,system_diagnostics_enabled,automatic_adaptations_enabled')
        .eq('user_id', userId)
        .maybeSingle();
      const paused = settings?.learning_paused_until && Date.parse(settings.learning_paused_until as string) > Date.now();
      if (settings?.learning_enabled === false || paused) {
        await finishRun(supabase, claim.runId, { status: 'skipped', details: { reason: paused ? 'paused' : 'disabled' } }, startedAt);
        outcomes.push({ user: userId, metrics: 0, status: 'disabled' });
        continue;
      }

      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - (weekly ? 7 : 1) * 86_400_000);
      const { data: logs } = await supabase
        .from('action_logs')
        .select('tool_name,status,duration_ms')
        .eq('user_id', userId)
        .gte('created_at', windowStart.toISOString())
        .lt('created_at', windowEnd.toISOString())
        .limit(5000);
      const groups = new Map<string, LogRow[]>();
      for (const row of (logs ?? []) as LogRow[]) {
        const subsystem = row.tool_name.split('.')[0] ?? 'system';
        groups.set(subsystem, [...(groups.get(subsystem) ?? []), row]);
      }

      let metricCount = 0;
      if (settings?.system_diagnostics_enabled !== false) {
        for (const [subsystem, rows] of groups) {
          const failures = rows.filter((row) => row.status !== 'success').length;
          const durations = rows.flatMap((row) => row.duration_ms == null ? [] : [row.duration_ms]);
          const metrics = [
            { name: 'failure_rate', value: failures / Math.max(rows.length, 1), unit: 'ratio' },
            { name: 'latency_ms', value: durations.reduce((sum, n) => sum + n, 0) / Math.max(durations.length, 1), unit: 'ms' },
          ];
          for (const metric of metrics) {
            const health = metricHealth(metric.name, metric.value, rows.length);
            await supabase.from('system_metrics').upsert({
              user_id: userId, subsystem, metric_name: metric.name, metric_value: metric.value,
              unit: metric.unit, sample_count: rows.length, health_status: health,
              window_started_at: windowStart.toISOString(), window_ended_at: windowEnd.toISOString(),
              metadata: { cadence: weekly ? 'weekly' : 'daily' },
            }, { onConflict: 'user_id,subsystem,metric_name,window_started_at' });
            metricCount += 1;
            if (health === 'degraded' && rows.length >= 5) {
              const title = `${subsystem} ${metric.name.replace('_', ' ')} needs attention`;
              const { data: existing } = await supabase.from('evolution_proposals').select('id').eq('user_id', userId).eq('title', title).eq('status', 'open').maybeSingle();
              if (!existing) await supabase.from('evolution_proposals').insert({
                user_id: userId, category: metric.name === 'latency_ms' ? 'performance' : 'reliability', title,
                problem: `${subsystem} measured ${metric.value.toFixed(2)} ${metric.unit} across ${rows.length} safe aggregate samples.`,
                evidence: [{ metric: metric.name, value: metric.value, samples: rows.length, window: weekly ? '7d' : '24h' }],
                confidence: Math.min(0.95, 0.6 + rows.length / 100),
                proposed_solution: 'Inspect the affected tool boundary, recent failures and timeout handling before changing behavior.',
                expected_benefit: 'Restore reliable, predictable execution without widening permissions.',
                risk_level: 'medium', affected_systems: [subsystem],
                test_plan: ['Reproduce with a safe fixture', 'Verify error handling', 'Run unit and integration tests', 'Compare the next aggregate window'],
                proposal_text: `Investigate ${subsystem} ${metric.name}. Evidence: ${metric.value.toFixed(2)} ${metric.unit} across ${rows.length} samples. Do not deploy automatically. Add a regression test and compare the next health window.`,
              });
            }
          }
        }
      }

      // Consolidation and gradual decay. User-confirmed and pinned items never decay.
      const { data: items } = await supabase.from('learning_items').select('id,kind,status,confidence,evidence_count,user_confirmed,pinned,last_reinforced_at,category,title,summary').eq('user_id', userId).is('deleted_at', null).limit(1000);
      for (const item of items ?? []) {
        let confidence = Number(item.confidence);
        const ageDays = (Date.now() - Date.parse(item.last_reinforced_at as string)) / 86_400_000;
        if (!item.user_confirmed && !item.pinned && ageDays > (item.kind === 'workflow' ? 30 : 21)) confidence *= Math.pow(0.5, (ageDays - 21) / 180);
        const status = item.user_confirmed
          ? item.kind === 'workflow' ? 'active' : 'confirmed'
          : confidence < 0.18 && ageDays > 90 ? 'retired'
            : Number(item.evidence_count) >= 5 && confidence >= 0.72 ? 'suggested'
              : Number(item.evidence_count) >= 3 && confidence >= 0.52 ? 'emerging' : 'observed';
        await supabase.from('learning_items').update({ confidence: Math.max(0, Math.min(1, confidence)), status }).eq('id', item.id);

        // The only automatic adaptation is low-risk spoken-response style.
        if (settings?.automatic_adaptations_enabled && item.user_confirmed && item.category === 'communication' && confidence >= 0.85) {
          await supabase.from('atlas_adaptations').upsert({
            user_id: userId, adaptation_key: `communication:${item.id}`, category: 'behavioral', title: item.title,
            description: item.summary, value: { prompt_instruction: item.summary }, reason: 'Confirmed communication preference',
            confidence, evidence: [{ learning_item_id: item.id }], risk_level: 'low', status: 'active', applied_at: new Date().toISOString(),
          }, { onConflict: 'user_id,adaptation_key' });
        }
      }

      await finishRun(supabase, claim.runId, { status: 'succeeded', details: { metrics: metricCount, items: items?.length ?? 0, weekly } }, startedAt);
      outcomes.push({ user: userId, metrics: metricCount, status: 'succeeded' });
    } catch (error) {
      await finishRun(supabase, claim.runId, { status: 'failed', errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown' }, startedAt);
      outcomes.push({ user: userId, metrics: 0, status: 'failed' });
    }
  }

  return Response.json({ outcomes });
});
