import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AtlasPermissionLevel,
  DISABLED_CAPABILITIES,
  isDisabledCapability,
  memoryRequiresApproval,
} from '@/lib/atlas/permissions/levels';
import {
  __clearRegistry,
  decidePermission,
  getTool,
  registerTool,
} from '@/lib/atlas/tools/registry';
import {
  canonicalJson,
  hashPayload,
  newIdempotencyKey,
  payloadMatchesHash,
} from '@/lib/atlas/approvals/payload';

afterEach(() => {
  __clearRegistry();
});

function fakeTool(name: string, level: AtlasPermissionLevel) {
  return {
    name,
    description: 'test',
    permissionLevel: level,
    inputSchema: z.object({ value: z.string() }),
    execute: async () => ({ ok: true as const, output: null, summary: 'done' }),
  };
}

describe('the registry is the boundary', () => {
  it('an unregistered tool cannot be invoked, whatever the model emits', () => {
    const decision = decidePermission('gmail.definitely_not_a_real_tool');
    expect(decision.outcome).toBe('unknown_tool');
    expect(getTool('gmail.definitely_not_a_real_tool')).toBeUndefined();
  });

  it('resolves Level 1 tools to allow', () => {
    registerTool(fakeTool('calendar.list_today', AtlasPermissionLevel.Automatic));
    expect(decidePermission('calendar.list_today')).toEqual({ outcome: 'allow', level: 1 });
  });

  it('resolves Level 2 tools to require_approval', () => {
    registerTool(fakeTool('gmail.execute_create_draft', AtlasPermissionLevel.RequiresApproval));
    expect(decidePermission('gmail.execute_create_draft')).toEqual({
      outcome: 'require_approval',
      level: 2,
    });
  });

  it('REFUSES to register a Level 3 tool at all', () => {
    // Level 3 is not a flag that could be flipped later — the capability must
    // not exist. Registering one fails loudly at startup.
    expect(() => registerTool(fakeTool('gmail.send', AtlasPermissionLevel.Disabled))).toThrow(
      /level 3 capabilities are not implemented/i,
    );
  });

  it('rejects duplicate registration', () => {
    registerTool(fakeTool('tasks.list', AtlasPermissionLevel.Automatic));
    expect(() => registerTool(fakeTool('tasks.list', AtlasPermissionLevel.Automatic))).toThrow(
      /already registered/,
    );
  });
});

describe('Level 3 capabilities', () => {
  const forbidden = [
    'gmail.send',
    'gmail.delete',
    'gmail.archive_bulk',
    'calendar.execute_delete',
    'payments.execute',
    'investments.execute',
    'purchases.execute',
    'publish.public',
    'os.control',
    'passwords.access',
    'data.share_external',
    'atlas_dart.connect',
    'atlas_academy.connect',
    'atlas_investments.connect',
    'financial.transaction',
  ];

  it.each(forbidden)('%s is refused with a specific reason', (name) => {
    const decision = decidePermission(name);
    expect(decision.outcome).toBe('refuse');
    if (decision.outcome === 'refuse') {
      expect(decision.level).toBe(3);
      // A specific refusal, not a generic "unknown tool" — Muhammad should be
      // told Atlas *cannot* do this, and the attempt logged as a refusal.
      expect(decision.reason.length).toBeGreaterThan(10);
    }
  });

  it('refuses a disabled capability even if something registered that name', () => {
    // Defence in depth: registerTool already refuses Level 3, but the disabled
    // check runs FIRST so a mislabelled registration cannot open a hole.
    registerTool(fakeTool('gmail.send', AtlasPermissionLevel.Automatic));
    expect(decidePermission('gmail.send').outcome).toBe('refuse');
  });

  it('names the three Atlas systems that must stay unreachable', () => {
    expect(isDisabledCapability('atlas_dart.connect')).toBe(true);
    expect(isDisabledCapability('atlas_academy.connect')).toBe(true);
    expect(isDisabledCapability('atlas_investments.connect')).toBe(true);
  });

  it('explains that a draft is the alternative to sending', () => {
    expect(DISABLED_CAPABILITIES['gmail.send']).toMatch(/draft/i);
  });
});

describe('memory sensitivity escalation', () => {
  it('leaves a plainly normal memory at Level 1', () => {
    expect(memoryRequiresApproval({ sensitivity: 'normal' })).toBe(false);
  });

  it.each(['personal', 'sensitive', 'highly_sensitive'])('escalates %s to Level 2', (sensitivity) => {
    expect(memoryRequiresApproval({ sensitivity })).toBe(true);
  });

  it('escalates when ambiguous, likely to change, or decision-relevant', () => {
    expect(memoryRequiresApproval({ sensitivity: 'normal', ambiguous: true })).toBe(true);
    expect(memoryRequiresApproval({ sensitivity: 'normal', likelyToChange: true })).toBe(true);
    expect(memoryRequiresApproval({ sensitivity: 'normal', importantToDecisions: true })).toBe(true);
  });

  it('escalates when sensitivity is unstated — when in doubt, ask', () => {
    expect(memoryRequiresApproval({ ambiguous: true })).toBe(true);
  });
});

describe('payload hashing', () => {
  it('is independent of key order', () => {
    // A harmless re-serialisation must not look like tampering, or it would
    // block a legitimate execution.
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('is independent of nested key order', () => {
    expect(hashPayload({ outer: { x: 1, y: 2 }, z: 3 })).toBe(
      hashPayload({ z: 3, outer: { y: 2, x: 1 } }),
    );
  });

  it('preserves array order, which IS significant', () => {
    expect(hashPayload({ to: ['a', 'b'] })).not.toBe(hashPayload({ to: ['b', 'a'] }));
  });

  it('changes when any value changes', () => {
    const original = { to: 'colleague@example.com', body: 'Thanks' };
    const tampered = { to: 'attacker@example.com', body: 'Thanks' };
    expect(hashPayload(original)).not.toBe(hashPayload(tampered));
  });

  it('treats an absent key and an undefined value as the same', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('verifies a matching payload and rejects a tampered one', () => {
    const payload = { to: 'colleague@example.com', subject: 'Re: Thursday' };
    const hash = hashPayload(payload);

    expect(payloadMatchesHash({ subject: 'Re: Thursday', to: 'colleague@example.com' }, hash)).toBe(
      true,
    );
    expect(payloadMatchesHash({ ...payload, to: 'attacker@example.com' }, hash)).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('are unique per proposal, so two separate requests stay separate', () => {
    const a = newIdempotencyKey('gmail.execute_create_draft');
    const b = newIdempotencyKey('gmail.execute_create_draft');
    expect(a).not.toBe(b);
  });

  it('carry the tool name for readability in the audit trail', () => {
    expect(newIdempotencyKey('calendar.execute_create')).toMatch(/^calendar\.execute_create:/);
  });
});
