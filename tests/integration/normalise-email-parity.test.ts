import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { normaliseEmail } from '@/lib/auth/normalise-email';
import { connect, isAvailable } from '../helpers/db';
import { NORMALISATION_CASES } from '../unit/normalise-email.test';

/**
 * The owner check runs in two places: TypeScript (`requireOwner`) and SQL (the
 * Before User Created hook). They must agree on what counts as the same
 * address.
 *
 * If they drift, one of two things happens, and both are bad: an address
 * passes the hook but fails the server check, locking Muhammad out of his own
 * application; or it passes the server check but was never really allowlisted.
 *
 * This test compares them on identical input rather than trusting that two
 * separately-maintained implementations stayed in step.
 */

const available = await isAvailable();
const suite = available ? describe : describe.skip;

let client: Client;

beforeAll(async () => {
  if (!available) return;
  client = await connect();
});

afterAll(async () => {
  if (!available) return;
  await client.end();
});

suite('TypeScript and SQL email normalisation agree', () => {
  it.each(NORMALISATION_CASES)('agrees on %j', async (input, expected) => {
    const { rows } = await client.query<{ sql_result: string | null }>(
      'select private.normalise_email($1)::text as sql_result',
      [input],
    );

    const sqlResult = rows[0]?.sql_result ?? null;
    const tsResult = normaliseEmail(input);

    expect(tsResult, 'TypeScript matches the documented expectation').toBe(expected);
    expect(sqlResult, 'SQL matches TypeScript').toBe(tsResult);
  });
});
