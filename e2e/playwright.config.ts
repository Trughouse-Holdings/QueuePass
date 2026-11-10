// Spec 022 (research R7): Playwright Test for the browser tests, run by `npm run e2e` against the
// `qpe2e` Compose stack. No retries, ever (FR-011, R13): a flaky test is fixed, not retried green.
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

/**
 * Spec 028 (tasks T025a): WebKit, Safari's engine, the stand-in for a Safari walk until one is
 * made on a Mac. Opt-in locally (`--project=webkit` or QP_E2E_WEBKIT=1). Spec 036 FR-012: in CI,
 * WebKit also runs the event-form journeys only, so a Safari-only difference is caught there.
 * The rest of the suite stays Chromium-only (`001` V3 fails in WebKit). Its browser:
 * `node node_modules/playwright/cli.js install webkit`.
 */
const argv = process.argv;
const WEBKIT =
  process.env.QP_E2E_WEBKIT === '1' ||
  argv.some((a, i) => a === '--project=webkit' || (a === '--project' && argv[i + 1] === 'webkit'));
const EVENT_FORM_WEBKIT = WEBKIT || !!process.env.CI;
// Workers load this file again with their own arguments: they learn of the project from here.
// So a QP_E2E_WEBKIT=1 left set in the shell makes a plain `npm run e2e` run WebKit too, where
// `001 V3` fails (code review round 1); unset it after a WebKit run.
if (WEBKIT) process.env.QP_E2E_WEBKIT = '1';

/** Event-form journeys that pick Starts, Ends, or doors (036 FR-012). */
const EVENT_FORM_TESTS =
  /(?:003-venue-event|020-time-zones|025-doors-open|031-atomic-event-create|035-event-form-flow|036-event-form-times)\.spec\.ts$/;

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
    ...(EVENT_FORM_WEBKIT
      ? [
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
            // A local `--project=webkit` of the whole suite would still fail 001 V3; limit it.
            testMatch: EVENT_FORM_TESTS,
          },
        ]
      : []),
  ],
});
