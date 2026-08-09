import {
  ATLAS_DEFAULT_TIMEZONE,
  localDateKey,
  zonedTimeToUtc,
} from '@/lib/time';
import type { BusyInterval, PlannerDraft, PlannerStepDraft } from '@/lib/atlas/planner/model';

const WEEKDAY = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

type Interval = { start: number; end: number };

function parseBusy(intervals: BusyInterval[]): Interval[] {
  return intervals
    .map((interval) => ({
      start: new Date(interval.start).getTime(),
      end: new Date(interval.end).getTime(),
    }))
    .filter((interval) => Number.isFinite(interval.start) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
}

function overlaps(start: number, end: number, intervals: Interval[]): boolean {
  return intervals.some((interval) => start < interval.end && end > interval.start);
}

function localParts(dateKey: string): [number, number, number] | null {
  const [year, month, day] = dateKey.split('-').map(Number);
  return year && month && day ? [year, month, day] : null;
}

function dateAtLocalHour(dateKey: string, hour: number, timezone: string): Date | null {
  const parts = localParts(dateKey);
  if (!parts) return null;
  return zonedTimeToUtc(parts[0], parts[1], parts[2], hour, 0, timezone);
}

function addLocalDays(dateKey: string, days: number): string {
  const parts = localParts(dateKey);
  if (!parts) return dateKey;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.toISOString().slice(0, 10);
}

function weekdayFor(dateKey: string): (typeof WEEKDAY)[number] {
  const parts = localParts(dateKey);
  if (!parts) return 'sunday';
  return WEEKDAY[new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()] ?? 'sunday';
}

function withinBounds(dateKey: string, earliest: string, latest: string): boolean {
  return dateKey >= earliest && dateKey <= latest;
}

/**
 * Calendar-aware deterministic scheduler.
 *
 * The model may suggest a time, but this function is the authority. A proposed
 * instant is accepted only when it is in range, respects an explicit avoided
 * weekday and does not overlap Google Calendar or another proposed step.
 * Otherwise the next free 30-minute boundary in the preferred window is used.
 */
export function schedulePlanSteps(input: {
  draft: PlannerDraft;
  busy: BusyInterval[];
  now?: Date;
  timezone?: string;
}): PlannerStepDraft[] {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? ATLAS_DEFAULT_TIMEZONE;
  const today = localDateKey(now, timezone);
  const earliest = input.draft.constraints.earliestDate ?? today;
  const latest = input.draft.constraints.latestDate ?? addLocalDays(earliest, 30);
  const startHour = input.draft.constraints.preferredStartHour ?? 8;
  const endHour = input.draft.constraints.preferredEndHour ?? 10;
  const avoid = new Set(input.draft.constraints.avoidWeekdays);
  const occupied = parseBusy(input.busy);

  function validCandidate(start: Date, durationMinutes: number): boolean {
    const startMs = start.getTime();
    const endMs = startMs + durationMinutes * 60_000;
    const dateKey = localDateKey(start, timezone);
    return (
      startMs >= now.getTime() &&
      withinBounds(dateKey, earliest, latest) &&
      !avoid.has(weekdayFor(dateKey)) &&
      !overlaps(startMs, endMs, occupied)
    );
  }

  function nextSlot(durationMinutes: number): Date | null {
    for (let dayOffset = 0; dayOffset <= 90; dayOffset += 1) {
      const dateKey = addLocalDays(earliest, dayOffset);
      if (!withinBounds(dateKey, earliest, latest) || avoid.has(weekdayFor(dateKey))) continue;

      const windowStart = dateAtLocalHour(dateKey, startHour, timezone);
      const windowEnd = dateAtLocalHour(dateKey, endHour, timezone);
      if (!windowStart || !windowEnd || windowEnd <= windowStart) continue;

      for (
        let candidateMs = windowStart.getTime();
        candidateMs + durationMinutes * 60_000 <= windowEnd.getTime();
        candidateMs += 30 * 60_000
      ) {
        const candidate = new Date(candidateMs);
        if (validCandidate(candidate, durationMinutes)) return candidate;
      }
    }
    return null;
  }

  return input.draft.steps.map((step) => {
    const proposed = step.scheduledStart ? new Date(step.scheduledStart) : null;
    const chosen =
      proposed && Number.isFinite(proposed.getTime()) && validCandidate(proposed, step.durationMinutes)
        ? proposed
        : nextSlot(step.durationMinutes);

    if (chosen) {
      occupied.push({
        start: chosen.getTime(),
        end: chosen.getTime() + step.durationMinutes * 60_000,
      });
      occupied.sort((a, b) => a.start - b.start);
    }

    return { ...step, scheduledStart: chosen?.toISOString() ?? null };
  });
}
