// Spec 022 (research R7): Playwright Test for the browser tests, run by `npm run e2e` against the
// `qpe2e` Compose stack. No retries, ever (FR-011, R13): a flaky test is fixed, not retried green.
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
