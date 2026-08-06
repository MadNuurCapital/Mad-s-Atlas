import { describe, expect, it } from 'vitest';

import { redactError, redactForLog, redactObject } from '@/lib/validation/redact';

/*
 * security-check: allow-secret-fixtures
 *
 * This file contains deliberately secret-SHAPED strings, because a redaction
 * test cannot exist without them. None is a real credential. The marker above
 * tells scripts/security-check.ts to skip this file, and is greppable so every
 * exception stays visible.
 */

/**
 * `action_logs` is retained for a year and is what Muhammad reads to
 * understand what Atlas did. Anything secret that reaches it is a leak with a
 * long half-life.
 */

describe('redactForLog', () => {
  const secrets: Array<[label: string, value: string]> = [
    ['Supabase secret key', 'sb_secret_abcdefghijklmnop'],
    ['Supabase publishable key', 'sb_publishable_abcdefghijklmnop'],
    ['Google API key', 'AIzaSyA1234567890123456789012345678901234'],
    ['Google client secret', 'GOCSPX-abcdefghijklmnopqrstuv'],
    ['Google access token', 'ya29.a0AfH6SMBabcdefghijklmnopqrstuvwxyz'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ];

  it.each(secrets)('removes a %s', (_label, secret) => {
    const output = redactForLog(`Calling API with ${secret} now`);
    expect(output).not.toContain(secret);
    expect(output).toContain('[redacted');
  });

  it('removes a private key block', () => {
    const key = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----';
    expect(redactForLog(`key: ${key}`)).not.toContain('MIIEvQIBADANBg');
  });

  it('removes a bearer token', () => {
    const output = redactForLog('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
  });

  it('removes anything that names itself a secret', () => {
    expect(redactForLog('api_key=supersecretvalue')).not.toContain('supersecretvalue');
    expect(redactForLog('password: hunter2')).not.toContain('hunter2');
  });

  it('leaves an ordinary summary intact', () => {
    // A redactor that mangles normal text gets removed, and then it protects
    // nothing at all.
    const summary = 'Created a task due tomorrow at 9am';
    expect(redactForLog(summary)).toBe(summary);
  });

  it('truncates an over-long summary', () => {
    const output = redactForLog('x'.repeat(2000));
    expect(output.length).toBeLessThan(600);
    expect(output).toContain('[truncated]');
  });
});

describe('redactObject', () => {
  it('drops values whose key names a secret', () => {
    const output = redactObject({
      toolName: 'gmail.search',
      access_token: 'ya29.realtokenvalue',
      apiKey: 'AIzaSyA1234567890123456789012345678901234',
      count: 5,
    }) as Record<string, unknown>;

    expect(output.toolName).toBe('gmail.search');
    expect(output.count).toBe(5);
    expect(output.access_token).toBe('[redacted]');
    expect(output.apiKey).toBe('[redacted]');
  });

  it('redacts nested values too', () => {
    const output = redactObject({
      request: { headers: { authorization: 'Bearer abcdefghijklmnopqrst' } },
    }) as { request: { headers: { authorization: string } } };

    expect(output.request.headers.authorization).toBe('[redacted]');
  });

  it('stops at a sane depth rather than recursing forever', () => {
    type Nested = { next?: Nested };
    const deep: Nested = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(() => redactObject(deep)).not.toThrow();
  });

  it('caps array length', () => {
    const output = redactObject(Array.from({ length: 500 }, (_, i) => i)) as unknown[];
    expect(output.length).toBeLessThanOrEqual(50);
  });
});

describe('redactError', () => {
  it('redacts a credential embedded in a provider message', () => {
    // Provider errors routinely echo the request URL, query string and all.
    const error = new Error('Request failed: https://api.example.com?key=AIzaSyA1234567890123456789012345678901234');
    const output = redactError(error);
    expect(output.message).not.toContain('AIzaSyA1234567890123456789012345678901234');
  });

  it('handles a non-Error being thrown', () => {
    expect(redactError('a bare string')).toEqual({
      name: 'UnknownError',
      message: '[redacted:non-error-thrown]',
    });
  });
});
