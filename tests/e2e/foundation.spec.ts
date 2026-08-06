import { expect, test } from '@playwright/test';

/**
 * Phase 1 end-to-end coverage.
 *
 * Scenarios 27 (desktop) and 26 (mobile Safari) from TESTING.md, plus the
 * health contract. The security scenarios that matter most — 4, 21, 22 — land
 * in Phases 5 and 6, once there is something to secure.
 */

test('health endpoint responds without revealing configuration', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.service).toBe('mads-atlas');
  expect(['ok', 'degraded']).toContain(body.status);

  // Nothing sensitive, ever — not even in a degraded response.
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/sb_secret_/);
  expect(raw).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
  expect(raw).not.toMatch(/GOCSPX-/);
  expect(body).not.toHaveProperty('env');
  expect(body).not.toHaveProperty('version');
});

test('root redirects to Today', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
});

test('every route renders', async ({ page }) => {
  const routes = [
    ['/today', 'Today'],
    ['/talk', 'Talk'],
    ['/calendar', 'Calendar'],
    ['/inbox', 'Inbox'],
    ['/tasks', 'Tasks'],
    ['/memory', 'Memory'],
    ['/ideas', 'Ideas'],
    ['/approvals', 'Approvals'],
    ['/history', 'History'],
    ['/settings', 'Settings'],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }
});

test('sign-in states that access is restricted', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByText(/single authorised account/i)).toBeVisible();
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop only');

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/today');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();

    await nav.getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(nav.getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');

  test('bottom navigation works and the page does not scroll sideways', async ({ page }) => {
    await page.goto('/today');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();

    await nav.getByRole('link', { name: 'Approvals' }).click();
    await expect(page).toHaveURL(/\/approvals$/);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
