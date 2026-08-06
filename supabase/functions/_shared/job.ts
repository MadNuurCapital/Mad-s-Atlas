/**
 * Scheduled-job scaffolding. Deno runtime — Supabase Edge Functions.
 *
 * Every job claims its unit of work BEFORE doing anything. The unique
 * constraint on (job_name, run_key) in private.job_runs is what makes a
 * duplicate cron firing harmless rather than merely unlikely: the second
 * invocation gets no row back and exits.
 *
 * See SCHEDULED_JOBS.md § Contract every job must satisfy.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export function adminClient(): SupabaseClient {
  // Injected automatically into Edge Functions; never set by hand.
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    throw new Error('Edge Function is missing its Supabase configuration.');
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type ClaimResult =
  | { claimed: true; runId: string }
  | { claimed: false; reason: 'already_running' };

/**
 * Claim a unit of work.
 *
 * `on conflict do nothing` plus a returned row is the whole mechanism. No row
 * means another invocation owns this unit — exit immediately rather than
 * racing it.
 */
export async function claimRun(
  supabase: SupabaseClient,
  jobName: string,
  runKey: string,
): Promise<ClaimResult> {
  const { data, error } = await supabase
    .schema('private')
    .from('job_runs')
    .insert({ job_name: jobName, run_key: runKey, status: 'running' })
    .select('id')
    .maybeSingle();

  // A unique violation IS the expected outcome when another run holds it.
  if (error?.code === '23505' || !data) {
    return { claimed: false, reason: 'already_running' };
  }

  if (error) throw new Error(`Could not claim ${jobName}: ${error.code}`);

  return { claimed: true, runId: (data as { id: string }).id };
}

export async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  outcome: { status: 'succeeded' | 'failed' | 'skipped'; errorCode?: string; details?: unknown },
  startedAt: number,
): Promise<void> {
  await supabase
    .schema('private')
    .from('job_runs')
    .update({
      status: outcome.status,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      error_code: outcome.errorCode ?? null,
      // Diagnostics only — never user content, never secrets.
      details: outcome.details ?? {},
    })
    .eq('id', runId);
}

/** The local calendar date in a timezone, as YYYY-MM-DD. */
export function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Only Supabase Cron may invoke these. The secret key in the Authorization
 * header is the check — these functions are otherwise publicly addressable.
 */
export function isAuthorisedCaller(request: Request): boolean {
  const header = request.headers.get('Authorization') ?? '';
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return expected.length > 0 && header === `Bearer ${expected}`;
}
