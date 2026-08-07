import 'server-only';

import { getGoogleAccessToken } from '@/lib/google/tokens';

/**
 * Gmail, read and draft only.
 *
 * There is no send function in this file, and `gmail.send` is not among the
 * requested OAuth scopes. Sending is impossible rather than merely disabled —
 * that is the difference between a policy and a boundary.
 *
 * Full message bodies are never returned to callers or persisted. Only the
 * metadata and a short snippet leave this module, per DATA_RETENTION.md.
 */

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  labels: string[];
  /** A short excerpt, not the body. Bounded so a body cannot leak via length. */
  snippet: string;
};

export type GmailResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: string; message: string };

async function gmailFetch<T>(
  userId: string,
  path: string,
  signal?: AbortSignal,
): Promise<GmailResult<T>> {
  const token = await getGoogleAccessToken(userId);
  if (!token.ok) {
    return { ok: false, errorCode: token.reason, message: token.message };
  }

  try {
    const response = await fetch(`${GMAIL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });

    if (response.status === 403) {
      // Consent can grant fewer scopes than were requested.
      return {
        ok: false,
        errorCode: 'insufficient_scope',
        message:
          'Atlas does not have permission to read your mail. Reconnect Google and grant Gmail access.',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        errorCode: `http_${response.status}`,
        message: 'Gmail could not be reached. Try again shortly.',
      };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, errorCode: 'network_error', message: 'Gmail could not be reached.' };
  }
}

function header(headers: Array<{ name?: string; value?: string }>, name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** Search messages. Returns metadata and snippets only — never full bodies. */
export async function searchMessages(
  userId: string,
  query: string,
  maxResults = 10,
  signal?: AbortSignal,
): Promise<GmailResult<GmailMessageSummary[]>> {
  const list = await gmailFetch<{ messages?: Array<{ id: string; threadId: string }> }>(
    userId,
    `/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(maxResults, 25)}`,
    signal,
  );

  if (!list.ok) return list;

  const ids = list.data.messages ?? [];
  const summaries: GmailMessageSummary[] = [];

  for (const { id } of ids) {
    // `format=metadata` means Gmail never sends us the body at all — the
    // cheapest way to guarantee we cannot accidentally store one.
    const detail = await gmailFetch<{
      id: string;
      threadId: string;
      labelIds?: string[];
      snippet?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    }>(
      userId,
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      signal,
    );

    if (!detail.ok) continue;

    const headers = detail.data.payload?.headers ?? [];
    summaries.push({
      id: detail.data.id,
      threadId: detail.data.threadId,
      from: header(headers, 'From'),
      subject: header(headers, 'Subject'),
      date: header(headers, 'Date'),
      labels: detail.data.labelIds ?? [],
      snippet: (detail.data.snippet ?? '').slice(0, 300),
    });
  }

  return { ok: true, data: summaries };
}

export type DraftInput = {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
};

/**
 * Create a Gmail DRAFT. Never sends.
 *
 * Reached only through an approved Level 2 action, so by the time this runs
 * Muhammad has seen the exact recipient and body on the approval card.
 */
export async function createDraft(
  userId: string,
  input: DraftInput,
  signal?: AbortSignal,
): Promise<GmailResult<{ draftId: string }>> {
  const token = await getGoogleAccessToken(userId);
  if (!token.ok) return { ok: false, errorCode: token.reason, message: token.message };

  const mime = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    input.body,
  ].join('\r\n');

  const raw = Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const response = await fetch(`${GMAIL_BASE}/drafts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        errorCode: `http_${response.status}`,
        message: 'The draft could not be created in Gmail.',
      };
    }

    const body = (await response.json()) as { id?: string };
    return { ok: true, data: { draftId: body.id ?? 'unknown' } };
  } catch {
    return { ok: false, errorCode: 'network_error', message: 'Gmail could not be reached.' };
  }
}
