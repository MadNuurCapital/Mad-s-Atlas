import 'server-only';

import { encryptToken } from '@/lib/crypto/tokens';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Persist Google OAuth tokens, encrypted.
 *
 * ── The rule this file exists to enforce ──────────────────────────────────
 *
 * Google returns a refresh token on FIRST consent and, in most cases, not on
 * any subsequent one. Code that writes back whatever the callback handed it
 * will therefore erase a perfectly good refresh token on the second sign-in.
 *
 * Nothing appears broken when that happens. The session works, Gmail works,
 * the calendar works — because the access token is still valid for an hour.
 * The failure surfaces days later, at 01:00 UTC, when an unattended cron job
 * needs to refresh and cannot. That delay is exactly why this is guarded in
 * three places: here, in the database trigger on `connected_accounts`, and in
 * an integration test.
 *
 * The database trigger is the real backstop. This function is the polite
 * version that simply omits the column.
 */

export type StoreGoogleTokensInput = {
  userId: string;
  email: string;
  providerAccountId: string;
  accessToken: string | null;
  refreshToken: string | null;
  /** Seconds until the access token expires, if the provider said. */
  expiresIn: number | null;
  grantedScopes?: string[];
};

export async function storeGoogleTokens(input: StoreGoogleTokensInput): Promise<void> {
  const admin = createAdminClient();

  // Access token: encrypt when present. Its IV and auth tag travel with it.
  const access = input.accessToken ? encryptToken(input.accessToken) : null;
  const refresh = input.refreshToken ? encryptToken(input.refreshToken) : null;

  const expiresAt =
    input.expiresIn && input.expiresIn > 0
      ? new Date(Date.now() + input.expiresIn * 1000).toISOString()
      : null;

  const base = {
    user_id: input.userId,
    provider: 'google' as const,
    provider_account_id: input.providerAccountId,
    email: input.email,
    connection_status: 'connected' as const,
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
    ...(input.grantedScopes ? { granted_scopes: input.grantedScopes } : {}),
    ...(access
      ? {
          encrypted_access_token: toHex(access.ciphertext),
          token_initialisation_vector: toHex(access.iv),
          token_authentication_tag: toHex(access.authTag),
          access_token_expires_at: expiresAt,
        }
      : {}),
  };

  // The refresh token is added ONLY when we actually received one. Omitting
  // the key leaves any stored value untouched — writing null would destroy it.
  const payload = refresh
    ? { ...base, encrypted_refresh_token: toHex(refresh.ciphertext) }
    : base;

  const { error } = await admin
    .from('connected_accounts')
    .upsert(payload, { onConflict: 'user_id,provider,provider_account_id' });

  if (error) {
    throw new Error(`Failed to store Google tokens: ${error.code ?? 'unknown'}`);
  }
}

/**
 * PostgREST takes `bytea` as a hex string with a `\x` prefix. Buffers do not
 * survive JSON serialisation, so this conversion is required, not cosmetic.
 */
function toHex(buffer: Buffer): string {
  return `\\x${buffer.toString('hex')}`;
}
