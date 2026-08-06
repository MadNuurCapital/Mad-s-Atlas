import { describe, expect, it } from 'vitest';

import { formatTime } from '@/lib/time';
import {
  RECURRENCE_PRESETS,
  RecurrenceError,
  describeRecurrence,
  nextOccurrence,
  parseRecurrence,
  upcomingOccurrences,
} from '@/lib/scheduling/recurrence';

const SGT = 'Asia/Singapore';

/** 09:00 Singapore on 6 August 2026 — which is 01:00 UTC. */
const NINE_AM_SGT = new Date('2026-08-06T01:00:00Z');

describe('parseRecurrence', () => {
  it('accepts a bare RRULE body', () => {
    expect(() => parseRecurrence('FREQ=DAILY')).not.toThrow();
  });

  it('accepts the RRULE: prefix', () => {
    expect(() => parseRecurrence('RRULE:FREQ=WEEKLY;BYDAY=MO')).not.toThrow();
  });

  it('rejects an empty rule', () => {
    expect(() => parseRecurrence('   ')).toThrow(RecurrenceError);
  });

  it('rejects nonsense with a message a person can act on', () => {
    expect(() => parseRecurrence('every other tuesday')).toThrow(/RFC 5545/);
  });
});

describe('nextOccurrence — wall-clock stability', () => {
  it('keeps a daily reminder at 9am Singapore, not 9am UTC', () => {
    // The core property. If this drifts, every recurring reminder fires eight
    // hours out and the daily briefing lands in the middle of the night.
    let cursor = NINE_AM_SGT;

    for (let day = 0; day < 10; day += 1) {
      const next = nextOccurrence(RECURRENCE_PRESETS.daily, NINE_AM_SGT, cursor, SGT);
      expect(next).not.toBeNull();
      expect(formatTime(next as Date, SGT), `day ${day + 1}`).toBe('9:00 am');
      cursor = next as Date;
    }
  });

  it('advances by exactly 24 hours for a daily rule in a fixed-offset zone', () => {
    const first = nextOccurrence(RECURRENCE_PRESETS.daily, NINE_AM_SGT, NINE_AM_SGT, SGT);
    expect(first?.toISOString()).toBe('2026-08-07T01:00:00.000Z');
  });

  it('handles a reminder set late in the Singapore evening', () => {
    // 23:30 SGT is 15:30 UTC the SAME day; an hour later it is the next UTC
    // day but the same Singapore evening. This is where naive UTC arithmetic
    // puts the occurrence on the wrong date.
    const lateEvening = new Date('2026-08-06T15:30:00Z');
    expect(formatTime(lateEvening, SGT)).toBe('11:30 pm');

    const next = nextOccurrence(RECURRENCE_PRESETS.daily, lateEvening, lateEvening, SGT);
    expect(next).not.toBeNull();
    expect(formatTime(next as Date, SGT)).toBe('11:30 pm');
    expect(next?.toISOString()).toBe('2026-08-07T15:30:00.000Z');
  });

  it('handles a reminder just after Singapore midnight', () => {
    // 00:30 SGT is 16:30 UTC the PREVIOUS day.
    const justAfterMidnight = new Date('2026-08-05T16:30:00Z');
    expect(formatTime(justAfterMidnight, SGT)).toBe('12:30 am');

    const next = nextOccurrence(
      RECURRENCE_PRESETS.daily,
      justAfterMidnight,
      justAfterMidnight,
      SGT,
    );
    expect(formatTime(next as Date, SGT)).toBe('12:30 am');
  });
});

describe('nextOccurrence — calendar rules', () => {
  it('skips the weekend for a weekdays rule', () => {
    // 6 August 2026 is a Thursday, so the next weekday occurrence is Friday,
    // and the one after that is Monday — not Saturday.
    const friday = nextOccurrence(
      RECURRENCE_PRESETS.weekdays,
      NINE_AM_SGT,
      NINE_AM_SGT,
      SGT,
    );
    expect(friday?.toISOString()).toBe('2026-08-07T01:00:00.000Z');

    const monday = nextOccurrence(
      RECURRENCE_PRESETS.weekdays,
      NINE_AM_SGT,
      friday as Date,
      SGT,
    );
    expect(monday?.toISOString()).toBe('2026-08-10T01:00:00.000Z');
  });

  it('respects a weekly BYDAY selection', () => {
    const occurrences = upcomingOccurrences(
      'FREQ=WEEKLY;BYDAY=MO,WE',
      NINE_AM_SGT,
      NINE_AM_SGT,
      4,
      SGT,
    );

    expect(occurrences).toHaveLength(4);
    for (const occurrence of occurrences) {
      const weekday = new Intl.DateTimeFormat('en-SG', {
        weekday: 'long',
        timeZone: SGT,
      }).format(occurrence);
      expect(['Monday', 'Wednesday']).toContain(weekday);
      expect(formatTime(occurrence, SGT)).toBe('9:00 am');
    }
  });

  it('is strictly after the cursor — never returns the same instant twice', () => {
    const first = nextOccurrence(RECURRENCE_PRESETS.daily, NINE_AM_SGT, NINE_AM_SGT, SGT);
    const second = nextOccurrence(
      RECURRENCE_PRESETS.daily,
      NINE_AM_SGT,
      first as Date,
      SGT,
    );
    expect(second?.getTime()).toBeGreaterThan((first as Date).getTime());
  });

  it('returns null once a COUNT-limited series is exhausted', () => {
    const rule = 'FREQ=DAILY;COUNT=2';
    const first = nextOccurrence(rule, NINE_AM_SGT, NINE_AM_SGT, SGT);
    expect(first).not.toBeNull();

    const second = nextOccurrence(rule, NINE_AM_SGT, first as Date, SGT);
    expect(second).toBeNull();
  });

  it('returns null past an UNTIL boundary', () => {
    const rule = 'FREQ=DAILY;UNTIL=20260808T010000Z';
    const beyond = new Date('2026-08-20T01:00:00Z');
    expect(nextOccurrence(rule, NINE_AM_SGT, beyond, SGT)).toBeNull();
  });
});

describe('upcomingOccurrences', () => {
  it('returns the requested number in ascending order', () => {
    const list = upcomingOccurrences(RECURRENCE_PRESETS.daily, NINE_AM_SGT, NINE_AM_SGT, 5, SGT);
    expect(list).toHaveLength(5);
    for (let i = 1; i < list.length; i += 1) {
      expect((list[i] as Date).getTime()).toBeGreaterThan((list[i - 1] as Date).getTime());
    }
  });

  it('caps the count so a caller cannot request an unbounded expansion', () => {
    const list = upcomingOccurrences(RECURRENCE_PRESETS.daily, NINE_AM_SGT, NINE_AM_SGT, 5000, SGT);
    expect(list.length).toBeLessThanOrEqual(100);
  });

  it('returns an empty array for a non-positive count', () => {
    expect(upcomingOccurrences(RECURRENCE_PRESETS.daily, NINE_AM_SGT, NINE_AM_SGT, 0, SGT)).toEqual([]);
  });
});

describe('describeRecurrence', () => {
  it('describes a valid rule in plain language', () => {
    expect(describeRecurrence(RECURRENCE_PRESETS.daily)).toMatch(/day/i);
  });

  it('says plainly when a rule cannot be interpreted, rather than guessing', () => {
    expect(describeRecurrence('nonsense')).toMatch(/could not interpret/i);
  });
});
