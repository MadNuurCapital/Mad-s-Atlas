import { describe, expect, it } from 'vitest';

import { withCurrentOccurrence } from '@/lib/data/reminders';
import type { Reminder } from '@/types/database';

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    title: 'Review the plan',
    description: null,
    remind_at: '2026-08-06T01:00:00.000Z',
    recurrence_rule: 'FREQ=DAILY',
    timezone: 'Asia/Singapore',
    delivery_channel: 'in_app',
    status: 'scheduled',
    related_task_id: null,
    google_calendar_event_id: null,
    idea_id: null,
    idea_step_id: null,
    last_triggered_at: null,
    next_trigger_at: '2026-08-06T01:00:00.000Z',
    created_at: '2026-08-06T00:00:00.000Z',
    updated_at: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('in-app recurring reminders', () => {
  it('calculates the next occurrence when a recurring reminder is read', () => {
    const value = withCurrentOccurrence(
      reminder(),
      new Date('2026-08-10T00:00:00.000Z'),
    );
    expect(value.next_trigger_at).toBe('2026-08-10T01:00:00.000Z');
  });

  it('does not advance one-off or disabled reminders', () => {
    const now = new Date('2026-08-10T00:00:00.000Z');
    const oneOff = reminder({ recurrence_rule: null });
    const disabled = reminder({ status: 'disabled' });
    expect(withCurrentOccurrence(oneOff, now)).toBe(oneOff);
    expect(withCurrentOccurrence(disabled, now)).toBe(disabled);
  });
});
