import { describe, expect, it } from 'vitest';

import type { PlannerDraft } from '@/lib/atlas/planner/model';
import { schedulePlanSteps } from '@/lib/atlas/planner/scheduling';

function firstStep(): PlannerDraft['steps'][number] {
  return {
    existingStepId: null,
    title: 'Review current ads',
    description: null,
    durationMinutes: 30,
    scheduledStart: null,
    createTask: true,
    createCalendarBlock: true,
    createReminder: true,
  };
}

function draft(overrides: Partial<PlannerDraft> = {}): PlannerDraft {
  return {
    understanding: 'Improve Meta ads with a short review and one controlled change.',
    instructions: ['Keep it simple.'],
    assumptions: [],
    constraints: {
      earliestDate: '2026-08-10',
      latestDate: '2026-08-17',
      avoidWeekdays: ['friday'],
      preferredStartHour: 8,
      preferredEndHour: 10,
    },
    steps: [
      firstStep(),
      {
        existingStepId: null,
        title: 'Choose one improvement',
        description: null,
        durationMinutes: 30,
        scheduledStart: null,
        createTask: true,
        createCalendarBlock: true,
        createReminder: true,
      },
    ],
    ...overrides,
  };
}

describe('Ideas planner scheduling', () => {
  it('uses the 8–10am default window and never overlaps Calendar or another step', () => {
    const steps = schedulePlanSteps({
      draft: draft(),
      timezone: 'Asia/Singapore',
      now: new Date('2026-08-10T00:00:00.000Z'),
      busy: [{ start: '2026-08-10T00:00:00.000Z', end: '2026-08-10T00:30:00.000Z' }],
    });

    expect(steps.map((step) => step.scheduledStart)).toEqual([
      '2026-08-10T00:30:00.000Z',
      '2026-08-10T01:00:00.000Z',
    ]);
  });

  it('keeps weekends available and respects a valid requested instant', () => {
    const saturday = '2026-08-15T00:00:00.000Z';
    const value = draft({
      steps: [{ ...firstStep(), scheduledStart: saturday }],
    });
    const [step] = schedulePlanSteps({
      draft: value,
      timezone: 'Asia/Singapore',
      now: new Date('2026-08-10T00:00:00.000Z'),
      busy: [],
    });
    expect(step?.scheduledStart).toBe(saturday);
  });

  it('rejects an avoided Friday and finds the next valid free slot', () => {
    const friday = '2026-08-14T00:00:00.000Z';
    const value = draft({
      constraints: { ...draft().constraints, earliestDate: '2026-08-14' },
      steps: [{ ...firstStep(), scheduledStart: friday }],
    });
    const [step] = schedulePlanSteps({
      draft: value,
      timezone: 'Asia/Singapore',
      now: new Date('2026-08-13T00:00:00.000Z'),
      busy: [],
    });
    expect(step?.scheduledStart).toBe('2026-08-15T00:00:00.000Z');
  });
});
