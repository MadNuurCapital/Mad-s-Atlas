import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/validation/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Sign out.
 *
 * Accepts GET so `requireOwner()` can redirect a signed-in non-owner here —
 * leaving them holding a valid session for an application they can never use
 * would mean every request re-runs the same rejected check.
 */
async function signOut(request: NextRequest) {
  const reason = new URL(request.url).searchParams.get('reason');

  const supabase = await createClient();
  await supabase.auth.signOut();

  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  const target = reason === 'not-owner' ? '/sign-in?error=not-owner' : '/sign-in';

  return NextResponse.redirect(`${appUrl}${target}`, {
    // 303 so the browser follows with GET regardless of the original method.
    status: 303,
  });
}

export const GET = signOut;
export const POST = signOut;
