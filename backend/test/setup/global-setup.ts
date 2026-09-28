import { startPostgres, connectionUrl } from './postgres-container';

/**
 * Jest globalSetup: one container for the whole run. Env vars set here are inherited by
 * worker processes, so every suite shares the same migrated database.
 */
export default async function globalSetup(): Promise<void> {
  const container = await startPostgres();
  const url = connectionUrl(container);

  process.env.DATABASE_URL = url;
  // Stash for teardown — globalSetup and globalTeardown share a process.
  (globalThis as Record<string, unknown>).__PG_CONTAINER__ = container;

  console.log(
    `\n[test] PostgreSQL ready with migrations applied: ${container.getHost()}:${container.getPort()}`,
  );
}
