import { createHash, randomUUID } from 'node:crypto';

/**
 * Payload hashing for approvals.
 *
 * The hash is what makes "the exact payload approved is the payload executed"
 * a checkable claim rather than a hope. It is computed when the approval is
 * created and verified immediately before the external call.
 *
 * Canonicalisation matters: `{a:1,b:2}` and `{b:2,a:1}` are the same payload
 * and must hash identically, or a harmless re-serialisation would look like
 * tampering and block a legitimate execution.
 */

/** Recursively sort object keys so serialisation is order-independent. */
function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalise);

  const entries = Object.entries(value as Record<string, unknown>)
    // Drop undefined: JSON.stringify omits it anyway, so including it would
    // make the hash depend on whether a key was absent or explicitly undefined.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const output: Record<string, unknown> = {};
  for (const [key, nested] of entries) {
    output[key] = canonicalise(nested);
  }
  return output;
}

export function canonicalJson(payload: unknown): string {
  return JSON.stringify(canonicalise(payload));
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * Verify a payload against the hash recorded at approval time.
 *
 * A mismatch means the payload changed after Muhammad approved it. Execution
 * must stop — editing an approval creates a NEW approval, so a changed payload
 * here is never legitimate.
 */
export function payloadMatchesHash(payload: unknown, expectedHash: string): boolean {
  return hashPayload(payload) === expectedHash;
}

/**
 * Idempotency key for a proposed action.
 *
 * Random rather than derived from the payload: two genuinely separate requests
 * to draft the same reply are two actions, and a content-derived key would
 * silently collapse them into one.
 */
export function newIdempotencyKey(toolName: string): string {
  return `${toolName}:${randomUUID()}`;
}
