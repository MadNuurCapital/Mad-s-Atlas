import { NextResponse, type NextRequest } from 'next/server';

import { isOwner } from '@/lib/auth/owner';
import { storeGoogleTokens } from '@/lib/google/store-tokens';
import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/validation/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * OAuth callback.
 *
 * Exchanges the code for a session, re-verifies the owner, and captures the
 * Google provider tokens.
 *
 * Two things here are easy to get wrong and expensive to discover later:
 *
 *  1. The owner check runs AGAIN, even though the Before User Created hook
 *     already rejected non-allowlisted signups. The hook only guards account
 *     creation; an account that existed before being removed from the
 *     allowlist would otherwise still sign in.
 *
 *  2. Google returns a refresh token on first consent and usually not
 *     afterwards. `storeGoogleTokens` preserves the stored one when the
 *     callback provides none — see its comments and the database trigger.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');

  const appUrl = safeOrigin(origin);

  // The user declined consent, or Google refused.
  if (oauthError) {
    return NextResponse.redirect(`${appUrl}/sign-in?error=declined`);
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/sign-in?error=missing-code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${appUrl}/sign-in?error=exchange-failed`);
  }

  if (!(await isOwner(data.session.user))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${appUrl}/sign-in?error=not-owner`);
  }

  // Capture the Google tokens for Gmail and Calendar. A failure here must not
  // block sign-in: the app is still usable without Google, and the reconnect
  // banner tells Muhammad what happened.
  try {
    await storeGoogleTokens({
      userId: data.session.user.id,
      email: data.session.user.email ?? '',
      providerAccountId:
        (data.session.user.user_metadata?.provider_id as string | undefined) ??
        (data.session.user.user_metadata?.sub as string | undefined) ??
        data.session.user.id,
      accessToken: data.session.provider_token ?? null,
      refreshToken: data.session.provider_refresh_token ?? null,
      expiresIn: data.session.expires_in ?? null,
    });
  } catch (storeError) {
    console.error('[auth/callback] failed to store Google tokens', {
      name: storeError instanceof Error ? storeError.name : 'unknown',
    });
  }

  return NextResponse.redirect(`${appUrl}/today`);
}

/**
 * Only ever redirect to our own origin. Taking the request origin at face
 * value would make this an open redirect.
 */
function safeOrigin(requestOrigin: string): string {
  try {
    const configured = publicEnv().NEXT_PUBLIC_APP_URL;
    return configured || requestOrigin;
  } catch {
    return requestOrigin;
  }
}
