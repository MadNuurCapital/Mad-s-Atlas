/**
 * Email normalisation for owner comparison.
 *
 * MUST stay behaviourally identical to `private.normalise_email` in
 * supabase/migrations/…_helpers_and_auth_hook.sql. If the two ever disagree,
 * an address could pass one layer of the owner check and fail the other —
 * which, depending on the direction, either locks Muhammad out or lets someone
 * else in. `tests/unit/normalise-email.test.ts` asserts they agree.
 *
 * Why normalise at all: Gmail ignores dots and treats everything after '+' as
 * an alias, so `m.ad+anything@gmail.com` delivers to `mad@gmail.com`. A plain
 * string comparison would let anyone who knows the owner's address construct
 * unlimited variants that look different to an allowlist but are the same
 * mailbox to Google.
 */

const GOOGLE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normaliseEmail(input: string | null | undefined): string | null {
  if (!input) return null;

  // NFKC first: visually identical Unicode forms must not compare as distinct.
  const email = input.normalize('NFKC').trim().toLowerCase();
  if (!email.includes('@')) return null;

  const atIndex = email.indexOf('@');
  let local = email.slice(0, atIndex);
  let domain = email.slice(atIndex + 1);

  if (!local || !domain) return null;
  // A second '@' means the address is malformed; reject rather than guess.
  if (domain.includes('@')) return null;

  // The +alias is never part of the identity, on any provider.
  const plusIndex = local.indexOf('+');
  if (plusIndex !== -1) local = local.slice(0, plusIndex);

  // Dots are insignificant on Google-hosted addresses only.
  if (GOOGLE_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }

  if (!local) return null;

  return `${local}@${domain}`;
}

/** Do two addresses identify the same mailbox? */
export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseEmail(a);
  const right = normaliseEmail(b);
  return left !== null && right !== null && left === right;
}
