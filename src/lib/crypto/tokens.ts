import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { serverEnv } from '@/lib/validation/env';

/**
 * AES-256-GCM for Google OAuth tokens at rest.
 *
 * GCM is authenticated encryption: the tag proves the ciphertext was not
 * modified. Decryption of tampered data FAILS rather than returning plausible
 * garbage, which is the property that matters when the plaintext is a
 * credential.
 *
 * The IV is 96 bits, the size GCM is specified for, and freshly random for
 * every encryption. Reusing an IV with the same key is catastrophic for GCM —
 * it leaks the authentication subkey — so `encryptToken` never accepts one
 * from a caller.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type EncryptedToken = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

export class TokenCryptoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TokenCryptoError';
    this.code = code;
  }
}

function encryptionKey(): Buffer {
  const key = Buffer.from(serverEnv().TOKEN_ENCRYPTION_KEY, 'base64');

  // Already validated at startup by the env schema; re-checked because a
  // wrong-length key here would otherwise throw an opaque OpenSSL error.
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError(
      'invalid_key_length',
      'TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.',
    );
  }

  return key;
}

export function encryptToken(plaintext: string): EncryptedToken {
  if (!plaintext) {
    throw new TokenCryptoError('empty_plaintext', 'Refusing to encrypt an empty token.');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptToken(encrypted: EncryptedToken): string {
  const { ciphertext, iv, authTag } = encrypted;

  if (iv.length !== IV_BYTES) {
    throw new TokenCryptoError('invalid_iv', 'Stored initialisation vector has the wrong length.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Never surface the underlying OpenSSL message: it varies by failure mode
    // and can distinguish a wrong key from tampered data.
    throw new TokenCryptoError(
      'decryption_failed',
      'Could not decrypt the stored token. The key may have changed, or the ' +
        'stored value may have been altered.',
    );
  }
}

/** Constant-time comparison, for anywhere a secret is checked against input. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
