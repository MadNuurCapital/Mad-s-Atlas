import { expect, test } from '@playwright/test';

/**
 * TESTING.md scenarios 4 and 5 — secret containment.
 *
 * The most important end-to-end assertion in the suite. Everything else about
 * voice privacy rests on the permanent Gemini key never reaching the browser,
 * so it is checked by intercepting real traffic rather than by inspection.
 */

/** Values that must never appear in anything the browser receives. */
function forbiddenValues(): Array<[name: string, value: string]> {
  const candidates: Array<[string, string | undefined]> = [
    ['GEMINI_API_KEY', process.env.GEMINI_API_KEY],
    ['SUPABASE_SECRET_KEY', process.env.SUPABASE_SECRET_KEY],
    ['GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET],
    ['TOKEN_ENCRYPTION_KEY', process.env.TOKEN_ENCRYPTION_KEY],
  ];

  return candidates.filter((entry): entry is [string, string] => Boolean(entry[1]));
}

/** Shapes that are always a leak, whether or not the env var is set here. */
const FORBIDDEN_PATTERNS: Array<[name: string, pattern: RegExp]> = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Google OAuth client secret', /GOCSPX-[A-Za-z0-9_-]{10,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{6,}/],
  ['Google refresh token', /1\/\/[A-Za-z0-9_-]{30,}/],
];

test('no secret reaches the browser while using the app', async ({ page }) => {
  const sightings: string[] = [];
  const named = forbiddenValues();

  function inspect(source: string, body: string) {
    for (const [name, value] of named) {
      if (body.includes(value)) sightings.push(`${name} in ${source}`);
    }
    for (const [name, pattern] of FORBIDDEN_PATTERNS) {
      if (pattern.test(body)) sightings.push(`${name} (pattern) in ${source}`);
    }
  }

  page.on('request', (request) => {
    const post = request.postData();
    if (post) inspect(`request ${request.url()}`, post);
  });

  page.on('response', async (response) => {
    const body = await response.text().catch(() => '');
    if (body) inspect(`response ${response.url()}`, body);
  });

  // Walk the app, including the page that mints voice tokens.
  for (const route of ['/sign-in', '/talk', '/today', '/approvals']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  expect(sightings, `secrets observed: ${sightings.join('; ')}`).toEqual([]);
});

test('the live-token endpoint refuses an unauthenticated caller', async ({ request }) => {
  const response = await request.post('/api/gemini/live-token');

  // 401 signed out, 403 signed in as a non-owner. Never 200, and never a token.
  expect([401, 403]).toContain(response.status());

  const body = await response.text();
  expect(body).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
  expect(body.toLowerCase()).not.toContain('token');
});

test('the live-token endpoint rejects GET so a stray link cannot burn a token', async ({
  request,
}) => {
  const response = await request.get('/api/gemini/live-token');
  expect(response.status()).toBe(405);
});
