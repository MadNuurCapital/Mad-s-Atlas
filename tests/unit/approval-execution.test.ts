import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeApproval } from '@/lib/atlas/approvals/service';
import { hashPayload } from '@/lib/atlas/approvals/payload';
import { __clearRegistry, getTool } from '@/lib/atlas/tools/registry';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/action-log', () => ({ logAction: vi.fn() }));

describe('approval execution tool registration', () => {
  beforeEach(() => {
    __clearRegistry();
    vi.clearAllMocks();
  });

  it('initialises the registry before resolving an approved calendar action', async () => {
    const payload = {
      summary: 'Portfolio review',
      start: '2026-08-08T10:00:00+08:00',
      end: '2026-08-08T11:00:00+08:00',
      timeZone: 'Asia/Singapore',
    };
    const approval = {
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      action_type: 'calendar.execute_create',
      proposed_payload: payload,
      payload_hash: hashPayload(payload),
      idempotency_key: 'calendar:test',
      title: 'Add portfolio review',
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: approval, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const rpc = vi.fn().mockResolvedValue({ error: { code: 'approval_not_claimable' } });

    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn().mockReturnValue({ select }),
      rpc,
    } as never);

    const outcome = await executeApproval(approval.id);

    expect(getTool('calendar.execute_create')).toBeDefined();
    expect(rpc).toHaveBeenCalledWith('claim_approval', {
      p_approval_id: approval.id,
      p_idempotency_key: approval.idempotency_key,
    });
    expect(outcome).toMatchObject({ ok: false, errorCode: 'not_claimable' });
  });
});
