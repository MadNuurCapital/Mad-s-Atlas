/**
 * Reminder delivery — every five minutes.
 *
 * The tightest schedule in the system and deliberately the cheapest job: it
 * scans one partial index.
 *
 * The run key includes the trigger TIME. Without it a recurring reminder would
 * claim the same key on every occurrence and fire only once, ever.
 */

import { adminClient, claimRun, finishRun, isAuthorisedCaller } from '../_shared/job.ts';

Deno.serve(async (request: Request) => {
  if (!isAuthorisedCaller(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorised.' }), { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = adminClient();
  const horizon = new Date(Date.now() + 5 * 60_000).toISOString();

  const { data: due } = await supabase
    .from('reminders')
    .select('id,user_id,title,remind_at,next_trigger_at,recurrence_rule,timezone')
    .eq('status', 'scheduled')
    .lte('next_trigger_at', horizon)
    .limit(50);

  const fired: string[] = [];

  for (const reminder of due ?? []) {
    const triggerAt = (reminder.next_trigger_at ?? reminder.remind_at) as string;
    // The trigger time is part of the identity — see the note above.
    const runKey = `reminder:${reminder.id}:${triggerAt}`;

    const claim = await claimRun(supabase, 'check_reminders', runKey);
    if (!claim.claimed) continue;

    try {
      await supabase
        .from('reminders')
        .update({
          last_triggered_at: new Date().toISOString(),
          // Recurring reminders need their next occurrence computed in their
          // OWN timezone; that expansion lives in the application layer, so a
          // one-off is closed here and a recurring one is left for it.
          status: reminder.recurrence_rule ? 'scheduled' : 'triggered',
        })
        .eq('id', reminder.id);

      await finishRun(supabase, claim.runId, { status: 'succeeded' }, startedAt);
      fired.push(reminder.id as string);
    } catch (error) {
      await finishRun(
        supabase,
        claim.runId,
        { status: 'failed', errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown' },
        startedAt,
      );
    }
  }

  return new Response(JSON.stringify({ fired: fired.length }), { status: 200 });
});
