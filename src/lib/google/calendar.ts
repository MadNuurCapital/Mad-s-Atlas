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
 * There is deliberately no delete function: `calendar.execute_delete` is
 * Level 3 in V1. Atlas can propose a deletion for Muhammad to action himself.
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
    maxResults: '50',
  });

  const result = await calendarFetch<{ items?: RawEvent[] }>(
    userId,
    `/calendars/primary/events?${params.toString()}`,
    { signal },
  );

  if (!result.ok) return result;

  return {
    ok: true,
    data: (result.data.items ?? [])
      .filter((raw) => raw.status !== 'cancelled')
      .map(normalise),
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
