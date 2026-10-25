import type { Config } from 'jest';
import base from './jest.config';

/**
 * Spec 020 research R20: the Backend's unit tests alone, for `npm run test:tz`
 * (scripts/test-tz.mjs), which runs them once per device zone. The main config's settings, limited
 * to test/unit, with no globalSetup or globalTeardown, so no Testcontainers PostgreSQL is started
 * and no Docker is needed. No coverage: `npm test` measures it with the main config.
 */
const { globalSetup: _setup, globalTeardown: _teardown, ...rest } = base;
void _setup;
void _teardown;

const config: Config = {
  ...rest,
  roots: ['<rootDir>/test/unit'],
  testRegex: '.*\\.spec\\.ts$',
  collectCoverage: false,
};

export default config;
