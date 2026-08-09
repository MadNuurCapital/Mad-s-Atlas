import 'server-only';

import { getGoogleAccessToken } from '@/lib/google/tokens';
import { ATLAS_DEFAULT_TIMEZONE } from '@/lib/time';

/**
 * Google Calendar.
 *
 * Reads and user-requested event creation are Level 1. The tool registry still
 * validates every field and logs the result, but an explicit request from Mad
 * does not create a redundant approval step.
 *
 * There is no generic voice delete tool. A narrowly scoped plan cleanup may
 * delete an exact event ID only after the compound Idea deletion payload has
 * been reviewed and approved.
 */

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

export type CalendarEvent = {
  id: string;
  summary: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  attendees: string[];
  status: string;
  htmlLink: string | null;
};

export type CalendarResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: string; message: string };

type RawEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string }>;
};

function normalise(raw: RawEvent): CalendarEvent {
  // An all-day event uses `date` rather than `dateTime`. Treating the two the
  // same puts all-day events at midnight UTC, which is the previous evening in
  // Singapore.
  const allDay = Boolean(raw.start?.date && !raw.start?.dateTime);

  return {
    id: raw.id,
    summary: raw.summary ?? '(no title)',
    description: raw.description ?? null,
    start: raw.start?.dateTime ?? raw.start?.date ?? '',
    end: raw.end?.dateTime ?? raw.end?.date ?? '',
    allDay,
    location: raw.location ?? null,
    attendees: (raw.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
    status: raw.status ?? 'confirmed',
    htmlLink: raw.htmlLink ?? null,
  };
}

async function calendarFetch<T>(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<CalendarResult<T>> {
  const token = await getGoogleAccessToken(userId);
  if (!token.ok) return { ok: false, errorCode: token.reason, message: token.message };

  try {
    const response = await fetch(`${CALENDAR_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });

    if (response.status === 403) {
      return {
        ok: false,
        errorCode: 'insufficient_scope',
        message:
          'Atlas does not have calendar permission. Reconnect Google and grant calendar access.',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        errorCode: `http_${response.status}`,
        message: 'Google Calendar could not be reached. Try again shortly.',
      };
    }

    if (response.status === 204) return { ok: true, data: undefined as T };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, errorCode: 'network_error', message: 'Google Calendar could not be reached.' };
  }
}

/** Events between two instants. Cancelled events are filtered out. */
export async function listEvents(
  userId: string,
  timeMin: Date,
  timeMax: Date,
  timeZone = ATLAS_DEFAULT_TIMEZONE,
  signal?: AbortSignal,
): Promise<CalendarResult<CalendarEvent[]>> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    // Expands recurring series into individual occurrences, which is what
    // "what's on today" actually means.
    singleEvents: 'true',
    orderBy: 'startTime',
    timeZone,
    maxResults: '2500',
  });
  const events: RawEvent[] = [];
  let pageToken: string | undefined;

  // A 90-day planning scan must not silently ignore a busy interval merely
  // because it fell after Google's first page. Ten full pages is a defensive
  // cap; if reached, planning fails closed instead of claiming availability.
  for (let page = 0; page < 10; page += 1) {
    if (pageToken) params.set('pageToken', pageToken);
    const result = await calendarFetch<{ items?: RawEvent[]; nextPageToken?: string }>(
      userId,
      `/calendars/primary/events?${params.toString()}`,
      { signal },
    );
    if (!result.ok) return result;
    events.push(...(result.data.items ?? []));
    pageToken = result.data.nextPageToken;
    if (!pageToken) {
      return {
        ok: true,
        data: events.filter((raw) => raw.status !== 'cancelled').map(normalise),
      };
    }
  }

  return {
    ok: false,
    errorCode: 'calendar_range_too_large',
    message: 'This calendar range has too many events to verify safely. Choose a shorter planning range.',
  };
}

export type CreateEventInput = {
  summary: string;
  description?: string;
  start: string;
  end: string;
  timeZone?: string;
  attendees?: string[];
};

/** Create an event after the Level 1 tool boundary validates the request. */
export async function createEvent(
  userId: string,
  input: CreateEventInput,
  signal?: AbortSignal,
): Promise<CalendarResult<{ eventId: string; htmlLink: string | null }>> {
  const result = await calendarFetch<RawEvent>(userId, '/calendars/primary/events', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start, timeZone: input.timeZone ?? ATLAS_DEFAULT_TIMEZONE },
      end: { dateTime: input.end, timeZone: input.timeZone ?? ATLAS_DEFAULT_TIMEZONE },
      ...(input.attendees?.length ? { attendees: input.attendees.map((email) => ({ email })) } : {}),
    }),
  });

  if (!result.ok) return result;
  return { ok: true, data: { eventId: result.data.id, htmlLink: result.data.htmlLink ?? null } };
}

/** Stable Google-compatible ID for one Atlas plan step. */
export function planCalendarEventId(stepId: string): string {
  // Google event IDs accept base32hex characters. UUID hex plus this prefix is
  // valid, and deterministic IDs make retrying a partial plan execution safe.
  return `atlasplan${stepId.replaceAll('-', '').toLowerCase()}`;
}

/** Create or update the exact event owned by an approved Atlas plan step. */
export async function upsertPlanEvent(
  userId: string,
  stepId: string,
  input: CreateEventInput,
  signal?: AbortSignal,
): Promise<CalendarResult<{ eventId: string; htmlLink: string | null }>> {
  const eventId = planCalendarEventId(stepId);
  const path = `/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const existing = await calendarFetch<RawEvent>(userId, path, { signal });
  const body = {
    id: eventId,
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start, timeZone: input.timeZone ?? ATLAS_DEFAULT_TIMEZONE },
    end: { dateTime: input.end, timeZone: input.timeZone ?? ATLAS_DEFAULT_TIMEZONE },
    extendedProperties: { private: { atlasIdeaStepId: stepId } },
  };

  let result = existing.ok
    ? await calendarFetch<RawEvent>(userId, path, {
        method: 'PUT',
        signal,
        body: JSON.stringify(body),
      })
    : existing.errorCode === 'http_404'
      ? await calendarFetch<RawEvent>(userId, '/calendars/primary/events', {
          method: 'POST',
          signal,
          body: JSON.stringify(body),
        })
      : existing;

  // A concurrent retry may create the deterministic event after our GET but
  // before POST. Convert that harmless 409 race into the same idempotent PUT.
  if (!result.ok && result.errorCode === 'http_409') {
    result = await calendarFetch<RawEvent>(userId, path, {
      method: 'PUT',
      signal,
      body: JSON.stringify(body),
    });
  }

  if (!result.ok) return result;
  return { ok: true, data: { eventId: result.data.id, htmlLink: result.data.htmlLink ?? null } };
}

/** Delete only an exact event already linked to an approved Idea operation. */
export async function deletePlanEvent(
  userId: string,
  eventId: string,
  signal?: AbortSignal,
): Promise<CalendarResult<null>> {
  const result = await calendarFetch<void>(
    userId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', signal },
  );
  if (!result.ok && result.errorCode === 'http_404') return { ok: true, data: null };
  if (!result.ok) return result;
  return { ok: true, data: null };
}
