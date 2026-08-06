import { NextResponse } from 'next/server';

import { createLiveToken } from '@/lib/ai/providers/gemini/live-token';
import { requireOwnerApi } from '@/lib/auth/owner';
import { checkVoiceBudget } from '@/lib/atlas/permissions/rate-limit';
import { logAction } from '@/lib/data/action-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Mint a single-use Gemini Live token.
 *
 * The ten steps from GEMINI_LIVE_SETUP.md, in order:
 *   1-2  verify the session and the owner, server-side
 *   3    rate-limit
 *   4-8  mint a one-use, model-locked, short-expiry token
 *   9    return ONLY the token and safe session config
 *   10   log the issuance — never the token
 *
 * The permanent GEMINI_API_KEY never leaves this process. An end-to-end test
 * asserts it appears in no browser payload.
 */
export async function POST() {
  const auth = await requireOwnerApi();

  if (!auth.ok) {
    // No detail beyond the status: an unauthenticated caller learns nothing
    // about whether the account exists.
    return NextResponse.json(
      { error: auth.status === 401 ? 'Not signed in.' : 'This application is private.' },
      { status: auth.status },
    );
  }

  const budget = await checkVoiceBudget(auth.session.user.id);
  if (!budget.allowed) {
    await logAction({
      toolName: 'gemini.live_token',
      operationType: 'refuse',
      actionSummary: 'Refused a voice session: budget reached',
      status: 'refused',
      errorCode: 'rate_limited',
    });

    return NextResponse.json(
      { error: budget.reason },
      { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } },
    );
  }

  try {
    const result = await createLiveToken();

    // Logged BEFORE returning, so a session that starts is always accounted
    // for — this row is also what the rate limiter counts.
    await logAction({
      toolName: 'gemini.live_token',
      operationType: 'execute',
      actionSummary: 'Issued an ephemeral voice token',
      status: 'success',
      metadata: { model: result.sessionConfig.model },
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    await logAction({
      toolName: 'gemini.live_token',
      operationType: 'execute',
      actionSummary: 'Failed to issue a voice token',
      status: 'failure',
      errorCode: error instanceof Error ? error.name : 'unknown',
    });

    return NextResponse.json(
      { error: 'Could not start a voice session. Please try again in a moment.' },
      { status: 502 },
    );
  }
}

/** GET is not a mint. Stating so prevents a stray link burning a token. */
export function GET() {
  return NextResponse.json({ error: 'Method not allowed.' }, { status: 405 });
}
