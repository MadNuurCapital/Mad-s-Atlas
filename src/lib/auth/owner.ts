import 'server-only';

import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

import { emailsMatch, normaliseEmail } from '@/lib/auth/normalise-email';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/validation/env';

/**
 * Owner verification — layer 2 of four.
 *
 * The other three are the allowlist table, the Before User Created auth hook,
 * and Row Level Security. This layer runs on EVERY protected server request,
 * because middleware is a convenience redirect and can be bypassed by anything
 * that talks to a route handler directly.
 *
 * See SECURITY.md § T2.
 */

export type OwnerSession = {
  user: User;
  email: string;
};

/**
 * The authenticated user, or null.
 *
 * Uses `getUser()`, not `getSession()`: getSession reads the cookie without
 * verifying it against the auth server, so a forged cookie would satisfy it.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

/** Is this user the owner? Checks the configured address AND the allowlist. */
export async function isOwner(user: User | null): Promise<boolean> {
  if (!user?.email) return false;

  const env = serverEnv();
  if (!emailsMatch(user.email, env.ATLAS_OWNER_EMAIL)) return false;

  // The configured address matching is not sufficient on its own: access can
  // be revoked by disabling the allowlist row without redeploying.
  //
  // The lookup MUST use the normalised address. The allowlist stores emails
  // normalised — private.normalise_email() strips Gmail dots and +aliases, and
  // seed-owner.ts writes that form — so querying with the raw address Google
  // returned ("evo.inub@gmail.com" against a stored "evoinub@gmail.com") finds
  // nothing and locks the real owner out of their own application.
  const lookupEmail = normaliseEmail(user.email);
  if (!lookupEmail) return false;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .schema('private')
      .from('allowed_users')
      .select('enabled')
      .eq('email', lookupEmail)
      .maybeSingle();

    if (error) {
      // Fail closed. An unreachable allowlist is not permission to proceed.
      console.error('[auth] allowlist lookup failed', { code: error.code });
      return false;
    }

    return data?.enabled === true;
  } catch (error) {
    console.error('[auth] allowlist lookup threw', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return false;
  }
}

/**
 * Require the owner, or redirect.
 *
 * Call this at the top of every protected server component and route handler.
 * It returns the session so callers do not need a second round trip.
 */
export async function requireOwner(): Promise<OwnerSession> {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect('/sign-in');
  }

  if (!(await isOwner(user))) {
    // A signed-in non-owner is signed out rather than merely redirected —
    // otherwise they keep a valid session for an application they can never
    // use, and every request re-runs the same rejected check.
    redirect('/auth/sign-out?reason=not-owner');
  }

  return { user, email: user.email ?? '' };
}

/**
 * Owner check for route handlers, which must return a response rather than
 * redirect. Returns null when authorised, or the response to send.
 */
export async function requireOwnerApi(): Promise<
  { ok: true; session: OwnerSession } | { ok: false; status: 401 | 403 }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, status: 401 };
  if (!(await isOwner(user))) return { ok: false, status: 403 };
  return { ok: true, session: { user, email: user.email ?? '' } };
}
