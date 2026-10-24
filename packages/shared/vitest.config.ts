import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Spec 011 research R10: npm test measures line coverage of this workspace's own source;
    // coverage/coverage-summary.json feeds scripts/coverage-report.mjs (R11). No thresholds
    // until 010-test-coverage.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // api-schema.ts is generated from contracts/openapi.yaml by npm run generate:api;
      // Constitution VI allows excluding generated code.
      exclude: [...coverageConfigDefaults.exclude, 'src/api-schema.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
