import 'server-only';

import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/validation/env';
import { redactError } from '@/lib/validation/redact';

/**
 * Google access-token lifecycle.
 *
 * The rule that everything here serves: **a refresh token is never destroyed
 * by a refresh attempt.** Google omits it on most re-consents, so code that
 * writes back whatever it received erases a working credential — and nothing
 * looks broken until an unattended cron run days later.
 */

export type GoogleAccessResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: 'not_connected' | 'needs_reconnection'; message: string };

type StoredAccount = {
  id: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_initialisation_vector: string | null;
  token_authentication_tag: string | null;
  refresh_token_initialisation_vector: string | null;
  refresh_token_authentication_tag: string | null;
  access_token_expires_at: string | null;
  connection_status: string;
};

/** PostgREST returns bytea as a `\x…` hex string. */
function fromHex(value: string | null): Buffer | null {
  if (!value) return null;
  return Buffer.from(value.startsWith('\\x') ? value.slice(2) : value, 'hex');
}

function toHex(buffer: Buffer): string {
  return `\\x${buffer.toString('hex')}`;
}

/** Refresh a minute early so a token cannot expire mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * A usable access token, refreshing if necessary.
 *
 * Returns a typed failure rather than throwing when Google needs reconnecting:
 * that is a normal state the UI and the scheduled jobs both handle, not an
 * exception.
 */
export async function getGoogleAccessToken(userId: string): Promise<GoogleAccessResult> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('connected_accounts')
    .select(
      'id,encrypted_access_token,encrypted_refresh_token,token_initialisation_vector,' +
        'token_authentication_tag,refresh_token_initialisation_vector,' +
        'refresh_token_authentication_tag,access_token_expires_at,connection_status',
    )
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      reason: 'not_connected',
      message: 'Google is not connected. Connect it in Settings.',
    };
  }

  const account = data as unknown as StoredAccount;

  if (account.connection_status === 'revoked' || account.connection_status === 'error') {
    return {
      ok: false,
      reason: 'needs_reconnection',
      message: 'Your Google connection needs to be renewed. Reconnect it in Settings.',
    };
  }

  const iv = fromHex(account.token_initialisation_vector);
  const tag = fromHex(account.token_authentication_tag);
  const accessCipher = fromHex(account.encrypted_access_token);

  const stillValid =
    account.access_token_expires_at &&
    new Date(account.access_token_expires_at).getTime() - EXPIRY_MARGIN_MS > Date.now();

  if (stillValid && accessCipher && iv && tag) {
    try {
      return { ok: true, accessToken: decryptToken({ ciphertext: accessCipher, iv, authTag: tag }) };
    } catch {
      // A decryption failure means the encryption key changed or the stored
      // value was altered. Fall through to a refresh rather than failing —
      // the refresh token may still be decryptable.
    }
  }

  return refreshAccessToken(userId, account);
}

async function refreshAccessToken(
  userId: string,
  account: StoredAccount,
): Promise<GoogleAccessResult> {
  const refreshCipher = fromHex(account.encrypted_refresh_token);
  const iv = fromHex(account.refresh_token_initialisation_vector);
  const tag = fromHex(account.refresh_token_authentication_tag);

  if (!refreshCipher || !iv || !tag) {
    await markNeedsReconnection(account.id, 'No stored refresh token.');
    return {
      ok: false,
      reason: 'needs_reconnection',
      message: 'Google needs to be reconnected. Reconnect it in Settings.',
    };
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken({ ciphertext: refreshCipher, iv, authTag: tag });
  } catch (error) {
    await markNeedsReconnection(account.id, redactError(error).message);
    return {
      ok: false,
      reason: 'needs_reconnection',
      message: 'Your stored Google credentials could not be read. Reconnect Google in Settings.',
    };
  }

  const env = serverEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // invalid_grant means the user revoked access or the token expired —
      // the 7-day expiry of a Testing-status OAuth app lands here.
      await markNeedsReconnection(account.id, `Refresh failed with status ${response.status}`);
      return {
        ok: false,
        reason: 'needs_reconnection',
        message:
          'Google declined to renew access. Reconnect Google in Settings. ' +
          'If this recurs weekly, the OAuth app is still in Testing status.',
      };
    }

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };

    if (!body.access_token) {
      await markNeedsReconnection(account.id, 'Refresh returned no access token.');
      return {
        ok: false,
        reason: 'needs_reconnection',
        message: 'Google did not return a usable token. Reconnect Google in Settings.',
      };
    }

    const encryptedAccess = encryptToken(body.access_token);

    // The whole point of this module. `refresh_token` is normally ABSENT here,
    // and the update below simply omits the column in that case rather than
    // writing null. The database trigger rejects a null overwrite too.
    const update: Record<string, string | null> = {
      encrypted_access_token: toHex(encryptedAccess.ciphertext),
      token_initialisation_vector: toHex(encryptedAccess.iv),
      token_authentication_tag: toHex(encryptedAccess.authTag),
      access_token_expires_at: body.expires_in
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : null,
      connection_status: 'connected',
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
    };

    if (body.refresh_token) {
      const encryptedRefresh = encryptToken(body.refresh_token);
      update.encrypted_refresh_token = toHex(encryptedRefresh.ciphertext);
      update.refresh_token_initialisation_vector = toHex(encryptedRefresh.iv);
      update.refresh_token_authentication_tag = toHex(encryptedRefresh.authTag);
    }

    const admin = createAdminClient();
    await admin.from('connected_accounts').update(update).eq('id', account.id);

    return { ok: true, accessToken: body.access_token };
  } catch (error) {
    await markNeedsReconnection(account.id, redactError(error).message);
    return {
      ok: false,
      reason: 'needs_reconnection',
      message: 'Could not reach Google to renew access. Try again, or reconnect in Settings.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function markNeedsReconnection(accountId: string, reason: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('connected_accounts')
    .update({
      connection_status: 'needs_reconnection',
      // Redacted message only — never a token, never a raw provider payload.
      last_error: reason.slice(0, 300),
    })
    .eq('id', accountId);
}
