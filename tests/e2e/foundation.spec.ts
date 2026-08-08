import { expect, test } from '@playwright/test';

/**
 * Foundation and access-control end-to-end coverage.
 *
 * Covers TESTING.md scenarios 3 (protected pages reject unauthenticated
 * access), 14 (email sending is unavailable), 26 (mobile) and 27 (desktop).
 *
 * The server under test runs with placeholder Supabase configuration, so no
 * session can ever be established — which is precisely the unauthenticated
 * case these assertions are about.
 */

const PROTECTED_ROUTES = [
  '/today',
  '/talk',
  '/calendar',
  '/inbox',
  '/tasks',
  '/memory',
  '/evolution',
  '/research',
  '/reminders',
  '/ideas',
  '/approvals',
  '/history',
  '/settings',
] as const;

test('health endpoint responds without revealing configuration', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.service).toBe('mads-atlas');
  expect(['ok', 'degraded']).toContain(body.status);

  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/sb_secret_/);
  expect(raw).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
  expect(raw).not.toMatch(/GOCSPX-/);
  expect(body).not.toHaveProperty('env');
  expect(body).not.toHaveProperty('version');
});

test('PWA manifest uses standalone mode and canonical Atlas icons', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "Mad's Atlas",
    short_name: 'Atlas',
    start_url: '/',
    display: 'standalone',
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: '/icons/atlas-192.png' }),
      expect.objectContaining({ src: '/icons/atlas-maskable-512.png', purpose: 'maskable' }),
    ]),
  );
});

test.describe('unauthenticated access', () => {
  test('every protected route redirects to sign-in', async ({ page }) => {
    // Server-side enforcement: the redirect comes from requireOwner() in the
    // layout, not from anything the browser could skip.
    for (const route of PROTECTED_ROUTES) {
      await page.goto(route);
      await expect(page, `${route} must not render while signed out`).toHaveURL(/\/sign-in/);
    }
  });

  test('root redirects to sign-in rather than rendering', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('no protected route leaks content before redirecting', async ({ page }) => {
    const response = await page.goto('/memory');
    expect(page.url()).toContain('/sign-in');

    const body = (await response?.text()) ?? '';
    // The memory screen's own copy must not appear in the delivered HTML.
    expect(body).not.toContain('Nothing remembered yet');
  });
});

test.describe('sign-in', () => {
  test('states that access is restricted and offers Google', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByText(/single authorised account/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
  });

  test('includes iPhone standalone and Apple icon metadata', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/icons/apple-touch-icon.png',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
  });

  test('says plainly that Atlas cannot send email', async ({ page }) => {
    // Scenario 14. The claim is backed by the absent gmail.send scope, but the
    // interface should say so where Muhammad grants consent.
    await page.goto('/sign-in');
    await expect(page.getByText(/cannot send email/i)).toBeVisible();
  });

  test('shows a non-specific message when access is refused', async ({ page }) => {
    // A stranger must not learn that some *other* address would work.
    await page.goto('/sign-in?error=not-owner');

    // Scoped to the paragraph: Next injects its own role="alert" route
    // announcer, so a bare getByRole('alert') matches two elements.
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(/this application is private/i);
    await expect(alert, 'must not echo any email address back').not.toContainText('@');
  });
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop only');

  test('sign-in renders without horizontal overflow', async ({ page }) => {
    await page.goto('/sign-in');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');

  test('sign-in fits the viewport', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
