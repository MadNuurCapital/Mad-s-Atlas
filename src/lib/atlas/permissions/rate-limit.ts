import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Rate limiting and cost guardrails.
 *
 * Backed by Postgres rather than Redis: one user does not justify another
 * moving part, and the counters need to survive a serverless cold start, which
 * an in-memory map would not.
 *
 * Limits are structural rather than advisory. Voice and grounded search are
 * the expensive paths, and an unbounded loop on either is the realistic way
 * this application becomes costly.
 */

export const BUDGETS = {
  /** Live voice sessions started per day. */
  voiceSessionsPerDay: 40,
  /** Ephemeral tokens per minute — a leaked page cannot mint in a loop. */
  liveTokensPerMinute: 5,
  /** All Gemini requests per day, across every feature. */
  geminiRequestsPerDay: 500,
  /** Grounded searches per single user request. */
  researchCallsPerRequest: 3,
  /** Depth of the tool-call loop. The model cannot search indefinitely. */
  maxToolLoopDepth: 5,
  /** Retries for a single tool. */
  maxRetries: 2,
} as const;

export type BudgetKey = keyof typeof BUDGETS;

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string; retryAfterSeconds: number };

/**
 * Count recent actions as the rate signal.
 *
 * `action_logs` is already written for every operation, so this needs no
 * second store and no extra write path that could drift from reality.
 */
export async function checkRateLimit(options: {
  userId: string;
  toolName: string;
  limit: number;
  windowSeconds: number;
  friendlyLimit: string;
}): Promise<RateLimitResult> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - options.windowSeconds * 1000).toISOString();

  const { count, error } = await admin
    .from('action_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', options.userId)
    .eq('tool_name', options.toolName)
    .gte('created_at', since);

  if (error) {
    // Fail OPEN for rate limiting specifically. A counter outage should not
    // lock Muhammad out of his own assistant; the daily cost caps and the
    // permission checks are the controls that must never fail open.
    console.error('[rate-limit] count failed', { code: error.code });
    return { allowed: true, remaining: options.limit };
  }

  const used = count ?? 0;
  if (used >= options.limit) {
    return {
      allowed: false,
      reason: options.friendlyLimit,
      retryAfterSeconds: options.windowSeconds,
    };
  }

  return { allowed: true, remaining: options.limit - used };
}

/** Voice-specific check: both the per-minute burst and the daily cap. */
export async function checkVoiceBudget(userId: string): Promise<RateLimitResult> {
  const perMinute = await checkRateLimit({
    userId,
    toolName: 'gemini.live_token',
    limit: BUDGETS.liveTokensPerMinute,
    windowSeconds: 60,
    friendlyLimit: 'Too many voice sessions started at once. Wait a moment and try again.',
  });
  if (!perMinute.allowed) return perMinute;

  return checkRateLimit({
    userId,
    toolName: 'gemini.live_token',
    limit: BUDGETS.voiceSessionsPerDay,
    windowSeconds: 86_400,
    friendlyLimit:
      "I've reached today's voice session limit, so I can't start another until tomorrow.",
  });
}
