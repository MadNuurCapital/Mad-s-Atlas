import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { normaliseEmail } from '@/lib/auth/normalise-email';
import { cleanup, connect, isAvailable } from '../helpers/db';

/**
 * Allowlist lookup — the regression suite for a real lock-out.
 *
 * The owner allowlist stores emails NORMALISED (Gmail dots stripped, +alias
 * removed). Google returns the address as the user typed it. Anything that
 * looks up the raw address against a normalised row finds nothing, and the
 * real owner is refused entry to their own application with a message that
 * gives no hint why.
 *
 * That shipped. These tests exist so it cannot ship again.
 */

const available = await isAvailable();
const suite = available ? describe : describe.skip;

let client: Client;

beforeAll(async () => {
  if (!available) return;
  client = await connect();
});

beforeEach(async () => {
  if (!available) return;
  await client.query('delete from private.allowed_users');
});

afterAll(async () => {
  if (!available) return;
  await client.query('delete from private.allowed_users');
  await cleanup(client);
  await client.end();
});

suite('SQL and TypeScript normalisation agree', () => {
  const cases = [
    'evo.inub@gmail.com',
    'EVO.INUB@GMAIL.COM',
    'evo.inub+atlas@gmail.com',
    'e.v.o.i.n.u.b@googlemail.com',
    '  evo.inub@gmail.com  ',
  ];

  it.each(cases)('both reduce %s to the same stored form', async (input) => {
    // Two implementations of one rule is a standing invitation to drift.
    // If they ever disagree, sign-in breaks and nothing else reports it.
    const { rows } = await client.query('select private.normalise_email($1) as email', [input]);
    expect(rows[0]?.email).toBe(normaliseEmail(input));
  });

  it('reduces a dotted Gmail address to the undotted form', async () => {
    const { rows } = await client.query(
      "select private.normalise_email('evo.inub@gmail.com') as email",
    );
    expect(rows[0]?.email).toBe('evoinub@gmail.com');
  });

  it('leaves non-Google domains dotted', async () => {
    const { rows } = await client.query(
      "select private.normalise_email('first.last@example.com') as email",
    );
    expect(rows[0]?.email).toBe('first.last@example.com');
    expect(normaliseEmail('first.last@example.com')).toBe('first.last@example.com');
  });
});

suite('the seeded owner can actually be found', () => {
  beforeEach(async () => {
    // Exactly what seed-owner.ts and the manual insert write.
    await client.query(
      `insert into private.allowed_users (email, enabled)
       values (private.normalise_email('evo.inub@gmail.com'), true)`,
    );
  });

  it('THE REGRESSION: the raw address Google returns finds the stored row', async () => {
    // The exact failure that locked the owner out: Google hands back
    // "evo.inub@gmail.com", the row holds "evoinub@gmail.com".
    const raw = 'evo.inub@gmail.com';

    const rawLookup = await client.query(
      'select enabled from private.allowed_users where email = $1',
      [raw],
    );
    expect(rawLookup.rowCount, 'raw lookup misses — this is why sign-in failed').toBe(0);

    const normalisedLookup = await client.query(
      'select enabled from private.allowed_users where email = $1',
      [normaliseEmail(raw)],
    );
    expect(normalisedLookup.rowCount, 'normalised lookup must find it').toBe(1);
    expect(normalisedLookup.rows[0]?.enabled).toBe(true);
  });

  it('the auth hook accepts the owner in every equivalent spelling', async () => {
    for (const spelling of [
      'evo.inub@gmail.com',
      'evoinub@gmail.com',
      'EVO.Inub@Gmail.com',
      'evo.inub+anything@gmail.com',
    ]) {
      const { rows } = await client.query('select private.is_email_allowed($1) as allowed', [
        spelling,
      ]);
      expect(rows[0]?.allowed, `${spelling} should be allowed`).toBe(true);
    }
  });

  it('a different address is still refused', async () => {
    for (const stranger of ['someone.else@gmail.com', 'evo.inub@example.com']) {
      const { rows } = await client.query('select private.is_email_allowed($1) as allowed', [
        stranger,
      ]);
      expect(rows[0]?.allowed, `${stranger} must NOT be allowed`).toBe(false);
    }
  });

  it('a disabled row refuses access without deleting the record', async () => {
    await client.query('update private.allowed_users set enabled = false');
    const { rows } = await client.query(
      "select private.is_email_allowed('evo.inub@gmail.com') as allowed",
    );
    expect(rows[0]?.allowed).toBe(false);
  });
});
