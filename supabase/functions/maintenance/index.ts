/**
 * Retention and cleanup.
 *
 * Dispatches by `task` so one deployed function covers several schedules.
 * Every task is a single security-definer call, so the work happens in the
 * database rather than being pulled out and pushed back.
 */

import { adminClient, claimRun, finishRun, isAuthorisedCaller } from '../_shared/job.ts';

const TASKS = {
  expire_approvals: 'purge_expired_approvals',
  purge_conversations: 'purge_expired_conversations',
  expire_memories: 'expire_memories',
  purge_action_logs: 'purge_action_logs',
} as const;

type TaskName = keyof typeof TASKS;

Deno.serve(async (request: Request) => {
  if (!isAuthorisedCaller(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorised.' }), { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { task?: string };
  const task = body.task as TaskName | undefined;

  if (!task || !(task in TASKS)) {
    return new Response(
      JSON.stringify({ error: `Unknown task. Expected one of: ${Object.keys(TASKS).join(', ')}` }),
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  const supabase = adminClient();

  // Bucketed to the hour: retention work is idempotent anyway, but this keeps
  // a retried invocation from filling the ledger with near-identical rows.
  const runKey = `${task}:${new Date().toISOString().slice(0, 13)}`;
  const claim = await claimRun(supabase, task, runKey);

  if (!claim.claimed) {
    return new Response(JSON.stringify({ skipped: 'already_running' }), { status: 200 });
  }

  try {
    const { data, error } = await supabase.rpc(TASKS[task]);
    if (error) throw new Error(error.code ?? 'rpc_failed');

    await finishRun(supabase, claim.runId, { status: 'succeeded', details: { affected: data } }, startedAt);
    return new Response(JSON.stringify({ task, affected: data }), { status: 200 });
  } catch (error) {
    await finishRun(
      supabase,
      claim.runId,
      { status: 'failed', errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown' },
      startedAt,
    );
    // The next scheduled run IS the retry. No immediate re-attempt.
    return new Response(JSON.stringify({ task, error: 'failed' }), { status: 500 });
  }
});
