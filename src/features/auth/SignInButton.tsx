'use client';

import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { publicEnv } from '@/lib/validation/env';

/**
 * The Google scopes Atlas requests — the minimum practical set.
 *
 * Deliberately absent: gmail.send (sending is Level 3 and has no code path),
 * gmail.modify, any Drive scope, and Contacts. Without the send scope, sending
 * email is impossible rather than merely disabled.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
].join(' ');

export function SignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);

    try {
      const supabase = createClient();
      const { NEXT_PUBLIC_APP_URL } = publicEnv();

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: SCOPES,
          queryParams: {
            // Required to receive a refresh token at all.
            access_type: 'offline',
            // Forces Google to issue a NEW refresh token. Without this, a
            // re-consent usually returns none, and a first-time setup after a
            // revoke would leave the scheduled jobs with no way to act.
            prompt: 'consent',
          },
          redirectTo: `${NEXT_PUBLIC_APP_URL}/auth/callback`,
        },
      });

      if (oauthError) {
        setError('Could not start sign-in. Please try again.');
        setPending(false);
      }
      // On success the browser navigates away; leave `pending` set.
    } catch {
      setError('Could not start sign-in. Please try again.');
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-md bg-surface-accent px-4 text-sm font-medium text-accent-text transition-colors hover:bg-forest-700 disabled:opacity-60"
      >
        <GoogleMark />
        {pending ? 'Redirecting to Google…' : 'Continue with Google'}
      </button>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4">
      <path
        fill="currentColor"
        d="M21.35 11.1h-9.17v2.98h5.27c-.23 1.37-1.6 4.02-5.27 4.02-3.17 0-5.76-2.62-5.76-5.85s2.59-5.85 5.76-5.85c1.8 0 3.01.77 3.7 1.43l2.53-2.44C16.79 3.9 14.7 3 12.18 3 7.03 3 2.86 7.17 2.86 12.25s4.17 9.25 9.32 9.25c5.38 0 8.94-3.78 8.94-9.1 0-.61-.06-1.07-.15-1.53z"
      />
    </svg>
  );
}
