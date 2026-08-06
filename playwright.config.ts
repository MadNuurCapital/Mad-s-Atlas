import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * Some CI images ship a pre-installed Chromium whose build number does not
 * match the one this @playwright/test version expects. When that symlink is
 * present, point at it explicitly rather than downloading a second copy.
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumExecutable = existsSync(PREINSTALLED_CHROMIUM)
  ? PREINSTALLED_CHROMIUM
  : undefined;

/**
 * WebKit is required for the real mobile Safari check (TESTING.md scenario 26)
 * but is not present in every environment. Rather than fail the whole suite,
 * the project is registered only when the engine is actually available, and
 * an iPhone-sized Chromium project always runs so layout regressions are still
 * caught. Set PLAYWRIGHT_REQUIRE_WEBKIT=1 to make a missing WebKit fatal —
 * production verification should use that.
 */
const hasWebkit = existsSync('/opt/pw-browsers') ? existsSync('/opt/pw-browsers/webkit') : true;
const requireWebkit = process.env.PLAYWRIGHT_REQUIRE_WEBKIT === '1';

if (requireWebkit && !hasWebkit) {
  throw new Error(
    'PLAYWRIGHT_REQUIRE_WEBKIT=1 but no WebKit engine is installed. ' +
      'Run `npx playwright install webkit`.',
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    // Never retain video of a session that may contain personal data.
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
    // Real mobile Safari — the most restrictive target for autoplay,
    // microphone permission and cookie policy.
    ...(hasWebkit
      ? [{ name: 'mobile-safari', use: { ...devices['iPhone 14'] } }]
      : []),
  ],

  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: 'npm run start',
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          /*
           * Obviously-fake placeholders so the app boots and the env schema
           * passes. They are not credentials and grant nothing: the Supabase
           * host does not resolve, so `getUser()` fails and every protected
           * route redirects to /sign-in — which is exactly the unauthenticated
           * behaviour these tests assert (TESTING.md scenario 3).
           *
           * Real values are never needed here, and must never be added.
           */
          NEXT_PUBLIC_APP_URL: baseURL,
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_placeholder',
        },
      },
});
