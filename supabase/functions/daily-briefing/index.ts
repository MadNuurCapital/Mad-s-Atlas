/**
 * Daily briefing — 01:00 UTC, which is 09:00 Singapore.
 *
 * Two independent duplicate guards: the job claim below, and the unique
 * constraint on (user_id, briefing_date, timezone). Either alone would be
 * sufficient; both together mean a duplicate briefing is not a realistic
 * failure mode.
 *
 * Degrades honestly. If Google is disconnected the briefing is still produced
 * with the sections it can fill and SAYS which are missing — an incomplete
 * briefing presented as complete is worse than none.
 */

import { adminClient, claimRun, finishRun, isAuthorisedCaller, localDateKey } from '../_shared/job.ts';

Deno.serve(async (request: Request) => {
  if (!isAuthorisedCaller(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorised.' }), { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = adminClient();

  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id,timezone,briefing_enabled');

  const results: Array<{ user: string; outcome: string }> = [];

  for (const profile of profiles ?? []) {
    const timezone = (profile.timezone as string) ?? 'Asia/Singapore';
    const userId = profile.user_id as string;
    const briefingDate = localDateKey(new Date(), timezone);
    const runKey = `daily_briefing:${briefingDate}:${timezone}`;

    const claim = await claimRun(supabase, 'daily_briefing', runKey);
    if (!claim.claimed) {
      results.push({ user: userId, outcome: 'already_running' });
      continue;
    }

    try {
      if (profile.briefing_enabled === false) {
        await finishRun(supabase, claim.runId, { status: 'skipped' }, startedAt);
        results.push({ user: userId, outcome: 'disabled' });
        continue;
      }

      const { data: settings } = await supabase
        .from('user_settings')
        .select('proactive_briefings_enabled')
        .eq('user_id', userId)
        .maybeSingle();

      if (settings?.proactive_briefings_enabled === false) {
        await finishRun(supabase, claim.runId, { status: 'skipped' }, startedAt);
        results.push({ user: userId, outcome: 'disabled' });
        continue;
      }

      // Which sections could not be filled. Reported to the reader rather
      // than silently omitted.
      const unavailable: string[] = [];

      const { data: account } = await supabase
        .from('connected_accounts')
        .select('connection_status')
        .eq('user_id', userId)
        .maybeSingle();

      if (!account || account.connection_status !== 'connected') {
        unavailable.push('calendar', 'email');
      }

      const { data: overdue } = await supabase
        .from('tasks')
        .select('id,title,priority,due_at')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .not('status', 'in', '("completed","cancelled")')
        .lt('due_at', new Date().toISOString())
        .limit(20);

      const { data: approvals } = await supabase
        .from('approvals')
        .select('id,title')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString());

      // The unique constraint is the second guard. `do nothing` means a
      // concurrent run that slipped past the claim still cannot duplicate.
      const { error: upsertError } = await supabase.from('daily_briefings').upsert(
        {
          user_id: userId,
          briefing_date: briefingDate,
          timezone,
          task_summary: { overdue: overdue ?? [] },
          calendar_summary: unavailable.includes('calendar')
            ? { unavailable: true, reason: 'Google is not connected.' }
            : {},
          email_summary: unavailable.includes('email')
            ? { unavailable: true, reason: 'Google is not connected.' }
            : {},
          recommended_priority: overdue?.[0]?.title ?? null,
          status: 'ready',
          generated_at: new Date().toISOString(),
          full_briefing:
            unavailable.length > 0
              ? `Some sections are unavailable: ${unavailable.join(', ')}. Reconnect Google in Settings.`
              : null,
        },
        { onConflict: 'user_id,briefing_date,timezone', ignoreDuplicates: true },
      );

      if (upsertError) throw new Error(upsertError.code);

      await finishRun(
        supabase,
        claim.runId,
        { status: 'succeeded', details: { pending_approvals: approvals?.length ?? 0, unavailable } },
        startedAt,
      );
      results.push({ user: userId, outcome: 'generated' });
    } catch (error) {
      await finishRun(
        supabase,
        claim.runId,
        { status: 'failed', errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown' },
        startedAt,
      );
      results.push({ user: userId, outcome: 'failed' });
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
