import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  count: 0,
  error: null as null | { code: string },
  eq: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          database.eq(column, value);
          return query;
        },
        gte: async () => ({ count: database.count, error: database.error }),
      };
      return query;
    },
  }),
}));

import { checkRateLimit } from '@/lib/atlas/permissions/rate-limit';

describe('rate limit accounting', () => {
  beforeEach(() => {
    database.count = 0;
    database.error = null;
    database.eq.mockClear();
  });

  it('counts only successful executions, not failures or refused retries', async () => {
    await checkRateLimit({
      userId: 'owner-id',
      toolName: 'gemini.live_token',
      limit: 5,
      windowSeconds: 60,
      friendlyLimit: 'wait',
    });

    expect(database.eq).toHaveBeenCalledWith('operation_type', 'execute');
    expect(database.eq).toHaveBeenCalledWith('status', 'success');
  });

  it('blocks at the successful-operation limit without counting a refusal', async () => {
    database.count = 5;

    await expect(
      checkRateLimit({
        userId: 'owner-id',
        toolName: 'gemini.live_token',
        limit: 5,
        windowSeconds: 60,
        friendlyLimit: 'wait',
      }),
    ).resolves.toEqual({ allowed: false, reason: 'wait', retryAfterSeconds: 60 });
  });

  it('fails open when the counter is unavailable', async () => {
    database.error = { code: 'counter_unavailable' };

    await expect(
      checkRateLimit({
        userId: 'owner-id',
        toolName: 'gemini.live_token',
        limit: 5,
        windowSeconds: 60,
        friendlyLimit: 'wait',
      }),
    ).resolves.toEqual({ allowed: true, remaining: 5 });
  });
});
