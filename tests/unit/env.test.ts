import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EnvironmentError, __resetEnvCache, environmentReadiness, serverEnv } from '@/lib/validation/env';

const ORIGINAL = { ...process.env };

function setValidServerEnv() {
  process.env.ATLAS_OWNER_EMAIL = 'owner@example.com';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_testvalue';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
}

beforeEach(() => {
  __resetEnvCache();
  setValidServerEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  __resetEnvCache();
});

describe('server environment', () => {
  it('accepts a complete configuration', () => {
    const env = serverEnv();
    expect(env.ATLAS_OWNER_EMAIL).toBe('owner@example.com');
    expect(env.ATLAS_TIMEZONE).toBe('Asia/Singapore');
    expect(env.GEMINI_LIVE_MODEL).toBe('gemini-3.1-flash-live-preview');
  });

  it('fails when a required variable is missing', () => {
    delete process.env.GEMINI_API_KEY;
    __resetEnvCache();
    expect(() => serverEnv()).toThrow(EnvironmentError);
  });

  it('NEVER includes a secret value in the error message', () => {
    // The whole reason this file exists. An error that helpfully echoes a
    // leaked key is worse than no error at all.
    const secret = 'sb_secret_this_must_never_be_printed';
    process.env.SUPABASE_SECRET_KEY = secret;
    process.env.TOKEN_ENCRYPTION_KEY = 'too-short';
    __resetEnvCache();

    try {
      serverEnv();
      expect.unreachable('expected serverEnv to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain('too-short');
      // It should still name the offending variable.
      expect(message).toContain('TOKEN_ENCRYPTION_KEY');
    }
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    __resetEnvCache();
    expect(() => serverEnv()).toThrow(/32 bytes/);
  });

  it('accepts a correctly sized encryption key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    __resetEnvCache();
    expect(() => serverEnv()).not.toThrow();
  });

  it('rejects a URL with a trailing slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000/';
    __resetEnvCache();
    const readiness = environmentReadiness();
    expect(readiness.ok).toBe(false);
    expect(readiness.missing).toContain('NEXT_PUBLIC_APP_URL');
  });
});

describe('environmentReadiness', () => {
  it('reports ok when everything is configured', () => {
    expect(environmentReadiness()).toEqual({ ok: true, missing: [] });
  });

  it('reports variable NAMES only, never values', () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    __resetEnvCache();

    const readiness = environmentReadiness();
    expect(readiness.ok).toBe(false);
    expect(readiness.missing).toContain('GOOGLE_CLIENT_SECRET');
    // Names are safe to expose; values are not, and none appear here.
    for (const name of readiness.missing) {
      expect(name).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it('does not throw when configuration is entirely absent', () => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    __resetEnvCache();
    expect(() => environmentReadiness()).not.toThrow();
    expect(environmentReadiness().ok).toBe(false);
  });
});
