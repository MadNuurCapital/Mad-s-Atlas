import { describe, expect, it } from 'vitest';

import {
  ATLAS_DEFAULT_TIMEZONE,
  SINGAPORE_UTC_OFFSET_MINUTES,
  localDateKey,
  timezoneOffsetMinutes,
  zonedTimeToUtc,
} from '@/lib/time';

describe('Singapore timezone', () => {
  it('is a fixed +08:00 offset', () => {
    expect(timezoneOffsetMinutes(new Date('2026-08-06T00:00:00Z'))).toBe(
      SINGAPORE_UTC_OFFSET_MINUTES,
    );
  });

  it('does NOT observe daylight saving in any month', () => {
    // The whole point: other zones shift twice a year, Singapore never does.
    // A regression here would silently move the daily briefing by an hour.
    for (let month = 1; month <= 12; month += 1) {
      const date = new Date(Date.UTC(2026, month - 1, 15, 12, 0, 0));
      expect(timezoneOffsetMinutes(date), `month ${month}`).toBe(
        SINGAPORE_UTC_OFFSET_MINUTES,
      );
    }
  });

  it('converts 09:00 Singapore to 01:00 UTC', () => {
    const utc = zonedTimeToUtc(2026, 8, 6, 9, 0, ATLAS_DEFAULT_TIMEZONE);
    expect(utc.toISOString()).toBe('2026-08-06T01:00:00.000Z');
  });

  it('converts midnight Singapore to 16:00 UTC the previous day', () => {
    const utc = zonedTimeToUtc(2026, 8, 6, 0, 0, ATLAS_DEFAULT_TIMEZONE);
    expect(utc.toISOString()).toBe('2026-08-05T16:00:00.000Z');
  });
});

describe('localDateKey', () => {
  it('uses the LOCAL date, not the UTC date', () => {
    // 17:00 UTC is already the next day in Singapore. Deriving the key from
    // toISOString() would file this briefing under the wrong date.
    const instant = new Date('2026-08-06T17:00:00Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-06');
    expect(localDateKey(instant, ATLAS_DEFAULT_TIMEZONE)).toBe('2026-08-07');
  });

  it('holds the same date through the Singapore working day', () => {
    expect(localDateKey(new Date('2026-08-06T01:00:00Z'))).toBe('2026-08-06');
    expect(localDateKey(new Date('2026-08-06T15:59:00Z'))).toBe('2026-08-06');
  });

  it('rolls over exactly at 16:00 UTC', () => {
    expect(localDateKey(new Date('2026-08-06T15:59:59Z'))).toBe('2026-08-06');
    expect(localDateKey(new Date('2026-08-06T16:00:00Z'))).toBe('2026-08-07');
  });
});
