import type { Config } from 'jest';

/**
 * 120s timeout: Testcontainers must pull and boot a real PostgreSQL 17 image and run
 * `prisma migrate deploy` before the first test. Constitution IV forbids an in-memory
 * substitute, and SQLite cannot express tstzrange / EXCLUDE / btree_gist at all —
 * see specs/002-admin-venues-events/research.md R6.
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  // Spec 011 research R10: npm test measures coverage; a short summary in the log, and
  // coverage/coverage-summary.json for scripts/coverage-report.mjs (R11). No threshold until 010.
  coverageReporters: ['text-summary', 'json-summary'],
  testEnvironment: 'node',
  testTimeout: 120_000,
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  moduleNameMapper: {
    // Resolve to the compiled CJS artifact, not the TS source: this is exactly what the
    // backend loads at runtime, so the tests exercise the same build the container does.
    // (The `pretest` script builds it.)
    '^@queuepass/shared$': '<rootDir>/../packages/shared/dist/cjs/index.js',
  },
};

export default config;
