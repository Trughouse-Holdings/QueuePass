import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Boots a real PostgreSQL 17 and applies every migration, so `event_no_overlap` and the
 * btree_gist extension exist in every test.
 *
 * Constitution IV forbids an in-memory substitute for persistence tests. Here that is not
 * merely principled: the scheduling rule IS a PostgreSQL exclusion constraint, so SQLite —
 * which has no tstzrange, EXCLUDE, or btree_gist — cannot express the feature at all.
 * Tests against a substitute would report green while the central invariant went untested.
 * See specs/002-admin-venues-events/research.md R6.
 */
export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('queuepass_test')
    .withUsername('queuepass')
    .withPassword('queuepass')
    .start();

  const url = `${container.getConnectionUri()}?schema=public`;

  // `migrate deploy`, never `db push` — db push bypasses migration SQL and would omit
  // the exclusion constraint entirely.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  return container;
}

export function connectionUrl(container: StartedPostgreSqlContainer): string {
  return `${container.getConnectionUri()}?schema=public`;
}
