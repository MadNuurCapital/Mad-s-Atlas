/**
 * Time handling for Mad's Atlas.
 *
 * One rule, applied everywhere: timestamps are STORED in UTC and DISPLAYED in
 * the user's timezone. Conversion happens at the edge, never in the database.
 *
 * Singapore is a fixed UTC+08:00 and has not observed daylight saving since
 * 1935. Never apply DST logic to it. `Intl` already knows this, which is why
 * every function here goes through `Intl` rather than arithmetic on offsets.
 */

export const ATLAS_DEFAULT_TIMEZONE = 'Asia/Singapore';

/** Singapore's fixed offset, in minutes. 09:00 SGT = 01:00 UTC. */
export const SINGAPORE_UTC_OFFSET_MINUTES = 480;

/** e.g. "Thursday, 6 August 2026" */
export function formatLongDate(date: Date, timeZone = ATLAS_DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/** e.g. "9:00 am" */
export function formatTime(date: Date, timeZone = ATLAS_DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(date);
}

/** e.g. "6 Aug, 9:00 am" */
export function formatDateTime(date: Date, timeZone = ATLAS_DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(date);
}

/**
 * The local calendar date in a timezone, as `YYYY-MM-DD`.
 *
 * This is what `daily_briefings.briefing_date` stores. Deriving it from
 * `toISOString()` would give the UTC date, which is wrong for eight hours of
 * every Singapore day.
 */
export function localDateKey(date: Date, timeZone = ATLAS_DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Offset of a timezone from UTC at a given instant, in minutes. */
export function timezoneOffsetMinutes(date: Date, timeZone = ATLAS_DEFAULT_TIMEZONE): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * Convert a wall-clock time in a timezone to the corresponding UTC instant.
 *
 * Used when scheduling: "09:00 in Asia/Singapore" must become 01:00 UTC before
 * it is stored or handed to cron.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = ATLAS_DEFAULT_TIMEZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = timezoneOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60_000);
}

/** Relative phrasing for recent events: "just now", "12m ago", "3h ago". */
export function formatRelative(date: Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
