import { describe, expect, it } from 'vitest';

import { emailsMatch, normaliseEmail } from '@/lib/auth/normalise-email';

/**
 * These cases are duplicated verbatim in tests/integration/normalise-email-parity.test.ts,
 * which runs them through the SQL function and asserts both produce the same
 * answer. If the two implementations drift, an address could satisfy one layer
 * of the owner check and fail another.
 */
export const NORMALISATION_CASES: Array<[input: string, expected: string | null]> = [
  ['owner@example.com', 'owner@example.com'],
  ['  Owner@Example.COM  ', 'owner@example.com'],
  // Gmail: dots are insignificant, +alias is not part of the identity.
  ['m.ad@gmail.com', 'mad@gmail.com'],
  ['M.A.D@GMail.com', 'mad@gmail.com'],
  ['mad+newsletter@gmail.com', 'mad@gmail.com'],
  ['m.ad+anything@googlemail.com', 'mad@gmail.com'],
  // Other providers: dots ARE significant, +alias still is not.
  ['a.b@outlook.com', 'a.b@outlook.com'],
  ['a.b+tag@outlook.com', 'a.b@outlook.com'],
  // Malformed.
  ['not-an-email', null],
  ['', null],
  ['@example.com', null],
  ['user@', null],
  ['+only@gmail.com', null],
];

describe('normaliseEmail', () => {
  it.each(NORMALISATION_CASES)('normalises %j', (input, expected) => {
    expect(normaliseEmail(input)).toBe(expected);
  });

  it('returns null for null and undefined', () => {
    expect(normaliseEmail(null)).toBeNull();
    expect(normaliseEmail(undefined)).toBeNull();
  });

  it('rejects an address with two @ signs rather than guessing', () => {
    expect(normaliseEmail('a@b@c.com')).toBeNull();
  });
});

describe('emailsMatch', () => {
  it('treats Gmail dot and +alias variants as the same mailbox', () => {
    // This is the attack it prevents: anyone who knows the owner's address can
    // generate unlimited variants that look different to a naive allowlist but
    // deliver to exactly the same inbox.
    expect(emailsMatch('m.ad+x@gmail.com', 'mad@gmail.com')).toBe(true);
    expect(emailsMatch('M.A.D@googlemail.com', 'mad@gmail.com')).toBe(true);
  });

  it('does not treat dot variants as equal on non-Google domains', () => {
    expect(emailsMatch('a.b@outlook.com', 'ab@outlook.com')).toBe(false);
  });

  it('never matches when either side is unusable', () => {
    expect(emailsMatch(null, 'mad@gmail.com')).toBe(false);
    expect(emailsMatch('mad@gmail.com', '')).toBe(false);
    expect(emailsMatch('bad', 'bad')).toBe(false);
  });

  it('does not match different mailboxes', () => {
    expect(emailsMatch('owner@example.com', 'intruder@example.com')).toBe(false);
  });
});
