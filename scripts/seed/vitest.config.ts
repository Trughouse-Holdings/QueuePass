import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Seeding 235 users against a real Keycloak takes well over Vitest's 5 s default.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    // The tests share one Keycloak realm, so they must not run concurrently.
    fileParallelism: false,
  },
});
