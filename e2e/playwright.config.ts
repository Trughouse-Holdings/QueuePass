// Spec 022 (research R7): Playwright Test for the browser tests, run by `npm run e2e` against the
// `qpe2e` Compose stack. No retries, ever (FR-011, R13): a flaky test is fixed, not retried green.
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

/**
 * Spec 028 (tasks T025a): WebKit, Safari's engine, the stand-in for a Safari walk until one is
 * made on a Mac. Opt-in: listed only when asked for (`--project=webkit`), so `npm run e2e` and CI
 * stay Chromium-only. Its browser: `node node_modules/playwright/cli.js install webkit`.
 */
const argv = process.argv;
const WEBKIT = argv.some(
  (a, i) => a === '--project=webkit' || (a === '--project' && argv[i + 1] === 'webkit'),
);

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  // R8: at most 3, so each worker's test accounts (by parallelIndex) never overlap.
  workers: CI ? 2 : 3,
  retries: 0,
  forbidOnly: CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ...(CI ? ([['github']] as const) : []),
  ],
  use: {
    // An action waits as long as an expectation, so a missing control fails with its own name, not
    // the 60-second test timeout (T031).
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(WEBKIT ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
});
