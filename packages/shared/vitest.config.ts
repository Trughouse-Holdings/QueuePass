import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { availableParallelism } from 'node:os';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Issue #118 (spec 010 research R7): at most 4 test workers. Vitest's default is one per CPU
    // thread less one (15 on a 16-thread laptop), each its own jsdom process. Two suites at once
    // then ran 30 of them, memory ran short, and a worker paged out for seconds
    // missed the 5 s test timeout (a 20 ms test reported at 10 s). CI's 4-CPU runner uses 3.
    maxWorkers: Math.max(1, Math.min(4, availableParallelism() - 1)),
    // Spec 011 research R10: npm test measures line coverage of this workspace's own source;
    // coverage/coverage-summary.json feeds scripts/coverage-report.mjs (R11). Constitution VI
    // floor (spec 010 research R1): the run fails when this workspace is below 80% of lines.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // api-schema.ts is generated from contracts/openapi.yaml by npm run generate:api;
      // Constitution VI allows excluding generated code.
      exclude: [...coverageConfigDefaults.exclude, 'src/api-schema.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 80 },
    },
    // Spec 020 research R20: no zone pin; QP_TEST_TZ (set by scripts/test-tz.mjs) runs the suite
    // under another device zone.
    env: { ...(process.env.QP_TEST_TZ ? { TZ: process.env.QP_TEST_TZ } : {}) },
  },
});
