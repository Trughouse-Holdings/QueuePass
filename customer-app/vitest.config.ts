import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const shared = (p: string): string =>
  new URL(`../packages/shared/src/${p}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    // Spec 011 research R10: npm test measures line coverage of this workspace's own source;
    // coverage/coverage-summary.json feeds scripts/coverage-report.mjs (R11). No thresholds
    // until 010-test-coverage.
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'json-summary'] },
    // Pin local time so date and time assertions are exact (spec 003 research R6).
    env: { TZ: 'America/New_York' },
  },
  resolve: {
    // Exact-match aliases: a plain '@queuepass/shared' key would also capture '/web' as a prefix.
    alias: [
      { find: /^@queuepass\/shared$/, replacement: shared('index.ts') },
      { find: /^@queuepass\/shared\/web$/, replacement: shared('web/index.ts') },
      { find: /^@queuepass\/shared\/theme\.css$/, replacement: shared('web/theme.css') },
    ],
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
});
