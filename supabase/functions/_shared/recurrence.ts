import { RRule } from 'npm:rrule@2.8.1';

function timezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
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

function toWallClock(instant: Date, timezone: string): Date {
  return new Date(instant.getTime() + timezoneOffsetMinutes(instant, timezone) * 60_000);
}

function fromWallClock(wallClock: Date, timezone: string): Date {
  const firstGuess = new Date(
    wallClock.getTime() - timezoneOffsetMinutes(wallClock, timezone) * 60_000,
  );
  return new Date(
    wallClock.getTime() - timezoneOffsetMinutes(firstGuess, timezone) * 60_000,
  );
}

/** Next RFC 5545 occurrence strictly after `after`, in the reminder's zone. */
export function nextOccurrence(
  recurrenceRule: string,
  seriesStart: Date,
  after: Date,
  timezone: string,
): Date | null {
  const trimmed = recurrenceRule.trim();
  const normalised = trimmed.toUpperCase().startsWith('RRULE:') ? trimmed.slice(6) : trimmed;
  const rule = RRule.fromString(normalised);
  const anchored = new RRule({ ...rule.origOptions, dtstart: toWallClock(seriesStart, timezone) });
  const next = anchored.after(toWallClock(after, timezone), false);
  return next ? fromWallClock(next, timezone) : null;
}
