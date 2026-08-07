'use client';

import { createClient } from '@/lib/supabase/client';
import { GOOGLE_OAUTH_SCOPE_STRING } from '@/lib/google/scopes';
import { publicEnv } from '@/lib/validation/env';

export async function beginGoogleOAuth(returnTo = '/today') {
  const supabase = createClient();
  const { NEXT_PUBLIC_APP_URL } = publicEnv();

  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_OAUTH_SCOPE_STRING,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      },
      redirectTo: `${NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(returnTo)}`,
    },
  });
}
