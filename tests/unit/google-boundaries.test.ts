import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { decryptToken, encryptToken, TokenCryptoError } from '@/lib/crypto/tokens';
import { __clearRegistry, decidePermission, getTool, listTools } from '@/lib/atlas/tools/registry';
import { registerAllTools } from '@/lib/atlas/tools/definitions';
import { __resetEnvCache } from '@/lib/validation/env';

const ORIGINAL = { ...process.env };

function withEncryptionKey() {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
  process.env.ATLAS_OWNER_EMAIL = 'owner@example.com';
  process.env.SUPABASE_SECRET_KEY = 'x';
  process.env.GEMINI_API_KEY = 'x';
  process.env.GOOGLE_CLIENT_ID = 'x';
  process.env.GOOGLE_CLIENT_SECRET = 'x';
  __resetEnvCache();
}

/**
 * Flip a byte. Written as a helper because `buffer[0] ^= 0xff` trips
 * noUncheckedIndexedAccess, and silencing that with a non-null assertion is
 * exactly what the lint rules forbid.
 */
function corrupt(buffer: Buffer): void {
  buffer.writeUInt8(buffer.readUInt8(0) ^ 0xff, 0);
}

afterEach(() => {
  process.env = { ...ORIGINAL };
  __resetEnvCache();
  __clearRegistry();
});

describe('email sending is structurally impossible', () => {
  it('the Gmail client exports no send function', () => {
    // Not a policy: there is no code to call. A future contributor adding one
    // has to defeat this test deliberately.
    const source = readFileSync('src/lib/google/gmail.ts', 'utf8');
    expect(source).not.toMatch(/messages\/send/);
    expect(source).not.toMatch(/export async function send/);
  });

  it('the requested OAuth scopes exclude gmail.send', () => {
    const scopeBlock = readFileSync('src/lib/google/scopes.ts', 'utf8');

    expect(scopeBlock).toContain('gmail.compose');
    expect(scopeBlock).toContain('gmail.readonly');
    expect(scopeBlock).not.toContain('gmail.send');
    expect(scopeBlock).not.toContain('gmail.modify');
    expect(scopeBlock).not.toContain('drive');
  });

  it('stores independent AES-GCM envelopes for access and refresh tokens', () => {
    const store = readFileSync('src/lib/google/store-tokens.ts', 'utf8');
    const migration = readFileSync(
      'supabase/migrations/20260807000012_google_token_envelopes.sql',
      'utf8',
    );

    expect(store).toContain('refresh_token_initialisation_vector');
    expect(store).toContain('refresh_token_authentication_tag');
    expect(migration).toContain('refresh_token_initialisation_vector');
    expect(migration).toContain('refresh_token_authentication_tag');
  });

  it('gmail.send is refused by the permission engine', () => {
    registerAllTools();
    const decision = decidePermission('gmail.send');
    expect(decision.outcome).toBe('refuse');
  });

  it('no registered tool can delete a calendar event', () => {
    registerAllTools();
    expect(getTool('calendar.execute_delete')).toBeUndefined();
    expect(decidePermission('calendar.execute_delete').outcome).toBe('refuse');
  });
});

describe('registered tools carry the right permission levels', () => {
  it('calendar and internal writes are automatic while Gmail drafts require approval', () => {
    registerAllTools();

    expect(decidePermission('calendar.list_today')).toEqual({ outcome: 'allow', level: 1 });
    expect(decidePermission('gmail.search')).toEqual({ outcome: 'allow', level: 1 });
    expect(decidePermission('tasks.create')).toEqual({ outcome: 'allow', level: 1 });
    expect(decidePermission('reminders.create')).toEqual({ outcome: 'allow', level: 1 });
    expect(decidePermission('calendar.execute_create')).toEqual({ outcome: 'allow', level: 1 });
    expect(decidePermission('memory.search')).toEqual({ outcome: 'allow', level: 1 });
    expect(decidePermission('memory.remember')).toEqual({ outcome: 'allow', level: 1 });
    expect(decidePermission('gmail.execute_create_draft')).toEqual({
      outcome: 'require_approval',
      level: 2,
    });
  });

  it('every Level 2 tool can describe what it will do', () => {
    // The approval card needs a human summary alongside the exact payload.
    registerAllTools();
    for (const tool of listTools()) {
      if (tool.permissionLevel === 2) {
        expect(tool.describeProposal, `${tool.name} needs describeProposal`).toBeDefined();
      }
    }
  });

  it('registering twice is a no-op rather than an error', () => {
    registerAllTools();
    expect(() => registerAllTools()).not.toThrow();
  });

  it('the draft proposal names the recipient explicitly', () => {
    // A recipient extracted from email content is attacker-controlled. It must
    // be visible on the approval card, not buried in the payload.
    registerAllTools();
    const tool = getTool('gmail.execute_create_draft');
    const described = tool?.describeProposal?.({
      to: 'attacker@evil.example',
      subject: 'Invoice',
      body: 'x',
    } as never);

    expect(described?.summary).toContain('attacker@evil.example');
    expect(described?.summary).toMatch(/not sent/i);
  });
});

describe('token encryption', () => {
  it('round-trips', () => {
    withEncryptionKey();
    const plaintext = '1//0abcdefghijklmnopqrstuvwxyz';
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });

  it('uses a fresh IV every time', () => {
    // Reusing an IV with the same key is catastrophic for GCM — it leaks the
    // authentication subkey — so encryptToken never accepts one from a caller.
    withEncryptionKey();
    const a = encryptToken('same input');
    const b = encryptToken('same input');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('FAILS on tampered ciphertext rather than returning garbage', () => {
    withEncryptionKey();
    const encrypted = encryptToken('a real token');
    corrupt(encrypted.ciphertext);
    expect(() => decryptToken(encrypted)).toThrow(TokenCryptoError);
  });

  it('fails on a tampered authentication tag', () => {
    withEncryptionKey();
    const encrypted = encryptToken('a real token');
    corrupt(encrypted.authTag);
    expect(() => decryptToken(encrypted)).toThrow(TokenCryptoError);
  });

  it('fails with the wrong key', () => {
    withEncryptionKey();
    const encrypted = encryptToken('a real token');

    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    __resetEnvCache();

    expect(() => decryptToken(encrypted)).toThrow(TokenCryptoError);
  });

  it('never leaks the underlying crypto error, which distinguishes failure modes', () => {
    withEncryptionKey();
    const encrypted = encryptToken('a real token');
    corrupt(encrypted.authTag);

    try {
      decryptToken(encrypted);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/unable to authenticate|bad decrypt/i);
    }
  });

  it('refuses to encrypt an empty token', () => {
    withEncryptionKey();
    expect(() => encryptToken('')).toThrow(/empty/i);
  });
});
