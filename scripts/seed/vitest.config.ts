import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Seeding 235 users against a real Keycloak takes well over Vitest's 5 s default.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    // The tests share one Keycloak realm, so they must not run concurrently.
    fileParallelism: false,
    // Spec 011 research R10: npm test measures line coverage of this workspace's own source;
    // coverage/coverage-summary.json feeds scripts/coverage-report.mjs (R11). Constitution VI
    // floor (spec 010 research R1): the run fails when this workspace is below 80% of lines.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 80 },
    },
  },
});
