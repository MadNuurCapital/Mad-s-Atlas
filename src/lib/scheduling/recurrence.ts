import { RRule } from 'rrule';

import { ATLAS_DEFAULT_TIMEZONE, timezoneOffsetMinutes } from '@/lib/time';

/**
 * Recurrence expansion for reminders.
 *
 * The rule that governs this file: a recurring reminder means a WALL-CLOCK
 * time in the user's own zone. "Every weekday at 9am" means 9am where he is,
 * not 9am UTC and not 9am wherever the server happens to run.
 *
 * `rrule` works in UTC (or floating) time only. So the approach is:
 *
 *   1. shift the UTC instant into the target zone's wall clock
 *   2. let rrule do the calendar arithmetic on that wall clock
 *   3. shift the result back to a real UTC instant
 *
 * For Asia/Singapore the offset is a fixed +08:00 and never varies, so step 3
 * is exact. The helper still recomputes the offset per instant rather than
 * assuming, because a reminder may carry any IANA zone and the fixed-offset
 * assumption is only safe for the one we default to.
 */

export class RecurrenceError extends Error {
  readonly code = 'invalid_recurrence_rule';

  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceError';
  }
}

/** Parse and validate an RFC 5545 RRULE, with a friendly failure. */
export function parseRecurrence(rule: string): RRule {
  const trimmed = rule.trim();
  if (!trimmed) throw new RecurrenceError('Recurrence rule is empty.');

  try {
    // Accept both "FREQ=DAILY" and "RRULE:FREQ=DAILY".
    const normalised = trimmed.toUpperCase().startsWith('RRULE:')
      ? trimmed.slice(6)
      : trimmed;
    return RRule.fromString(normalised);
  } catch {
    throw new RecurrenceError(
      `Could not understand the recurrence rule "${rule}". Expected an RFC 5545 ` +
        'RRULE such as FREQ=WEEKLY;BYDAY=MO,WE,FR.',
    );
  }
}

/** A UTC instant → the same wall-clock reading as if it were UTC. */
function toZonedWallClock(instant: Date, timeZone: string): Date {
  return new Date(instant.getTime() + timezoneOffsetMinutes(instant, timeZone) * 60_000);
}

/** A wall-clock reading in `timeZone` → the real UTC instant. */
function fromZonedWallClock(wallClock: Date, timeZone: string): Date {
  // Offset is resolved against an approximate instant first, then corrected.
  // For fixed-offset zones such as Singapore both passes agree; for zones with
  // daylight saving this converges on the correct side of a transition.
  const firstGuess = new Date(
    wallClock.getTime() - timezoneOffsetMinutes(wallClock, timeZone) * 60_000,
  );
  const correction = timezoneOffsetMinutes(firstGuess, timeZone);
  return new Date(wallClock.getTime() - correction * 60_000);
}

/**
 * The next occurrence strictly after `after`, or null when the series has
 * ended (COUNT or UNTIL exhausted).
 */
export function nextOccurrence(
  recurrenceRule: string,
  seriesStart: Date,
  after: Date,
  timeZone: string = ATLAS_DEFAULT_TIMEZONE,
): Date | null {
  const rule = parseRecurrence(recurrenceRule);

  const zonedStart = toZonedWallClock(seriesStart, timeZone);
  const zonedAfter = toZonedWallClock(after, timeZone);

  // Rebuild with the series start as DTSTART; RRULE strings rarely carry one,
  // and without it rrule anchors on "now", which drifts every time it runs.
  const anchored = new RRule({ ...rule.origOptions, dtstart: zonedStart });

  const next = anchored.after(zonedAfter, false);
  if (!next) return null;

  return fromZonedWallClock(next, timeZone);
}

/** The next `count` occurrences after `after`. Bounded to avoid runaway. */
export function upcomingOccurrences(
  recurrenceRule: string,
  seriesStart: Date,
  after: Date,
  count: number,
  timeZone: string = ATLAS_DEFAULT_TIMEZONE,
): Date[] {
  const safeCount = Math.min(Math.max(count, 0), 100);
  const results: Date[] = [];

  let cursor = after;
  for (let i = 0; i < safeCount; i += 1) {
    const next = nextOccurrence(recurrenceRule, seriesStart, cursor, timeZone);
    if (!next) break;
    results.push(next);
    cursor = next;
  }

  return results;
}

/** Plain-language description, for confirming what was understood. */
export function describeRecurrence(recurrenceRule: string): string {
  try {
    return parseRecurrence(recurrenceRule).toText();
  } catch {
    return 'a schedule Atlas could not interpret';
  }
}

/** Common patterns, so the UI need not ask anyone to write RRULE by hand. */
export const RECURRENCE_PRESETS = {
  daily: 'FREQ=DAILY',
  weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'FREQ=WEEKLY',
  fortnightly: 'FREQ=WEEKLY;INTERVAL=2',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
} as const;

export type RecurrencePreset = keyof typeof RECURRENCE_PRESETS;
