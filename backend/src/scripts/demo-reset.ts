import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma, type PrismaClient } from '@prisma/client';
import { formatTimeOfDay } from '@queuepass/shared';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { DEMO_VENUE, runDemoData, type DemoSummary } from './demo-data';

/**
 * The demo checkpoint (spec 029, research R1): removes every row of every QueuePass table, keeps
 * the schema and the migration record, and loads the demo data again through the Backend's own
 * services, so every reset ends in the same demo state, relative to the moment it ran.
 *
 *     docker compose exec -e QUEUEPASS_ALLOW_RESET=1 backend node backend/dist/scripts/demo-reset.js
 *     QUEUEPASS_ALLOW_RESET=1 node scripts/run-host.mjs --demo-reset          (path B)
 *
 * Refused (FR-009, R7) unless QUEUEPASS_ALLOW_RESET is exactly `1` and DATABASE_URL names a local
 * host, both checked before anything is connected to; then (FR-010) unless every migration the
 * Backend ships is applied. Never run by `docker compose up` (FR-003, Constitution VIII). Keycloak
 * is not touched (FR-008, R4).
 */

/** Where the reset works, never the password (FR-011). */
export interface ResetTarget {
  host: string;
  port: number;
  database: string;
}

/** A refusal: nothing was removed. The message is what the person sees. */
export class ResetRefused extends Error {
  override readonly name = 'ResetRefused';
}

/** FR-013: the data was removed, but the demo state did not load completely. */
export class ResetIncomplete extends Error {
  override readonly name = 'ResetIncomplete';
}

const PERMISSION =
  'Refused: this removes every venue, event, order and ticket. To reset a local QueuePass ' +
  'database, set QUEUEPASS_ALLOW_RESET=1 for this command (see README, Demo checkpoint).';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const notLocal = (host: string): ResetRefused =>
  new ResetRefused(
    `Refused: the database host ${host} is not local (allowed: localhost, 127.0.0.1, ::1, ` +
      'and database inside a container).',
  );
const NOT_MIGRATED =
  'Refused: this database is not a QueuePass database, or its migrations are not all applied. ' +
  'Start the Backend once (it applies them), then reset.';
const BUSY = 'Refused: the database is busy; try again.';

/**
 * Research R7, checks 1 and 2: the permission, then the database host, from the environment
 * alone. `inContainer` defaults to Docker's `/.dockerenv`: `database` is the Compose stack's own
 * service only inside its network; elsewhere a hosts file or a search domain could send it away.
 */
export function checkResetAllowed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  { inContainer = existsSync('/.dockerenv') }: { inContainer?: boolean } = {},
): ResetTarget {
  if (env.QUEUEPASS_ALLOW_RESET !== '1') throw new ResetRefused(PERMISSION);

  const raw = env.DATABASE_URL;
  if (!raw) {
    throw new ResetRefused(
      'Refused: DATABASE_URL is missing, so the database host is not known to be local.',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ResetRefused(
      'Refused: DATABASE_URL cannot be read, so the database host is not known to be local.',
    );
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw notLocal(host);
  if (!(LOCAL_HOSTS.includes(host) || (host === 'database' && inContainer))) throw notLocal(host);
  // libpq's host overrides would send the connection elsewhere, whatever the URL's host says.
  for (const key of url.searchParams.keys()) {
    const k = key.toLowerCase();
    if (k === 'host' || k === 'hostaddr') throw notLocal(`${host} (with ${k}= in its options)`);
  }
  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

/** The target as printed (`localhost:5432/queuepass`). */
const where = (t: ResetTarget): string =>
  `${t.host.includes(':') ? `[${t.host}]` : t.host}:${t.port}/${t.database}`;

/** The compiled migrations folder, from `dist/scripts` or `src/scripts` alike. */
export const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');

type Db = Pick<PrismaClient, '$queryRaw'>;

/**
 * Research R7, check 3 (FR-010): the migration record exists in the current schema, and every
 * migration folder the Backend ships has a finished row that was not rolled back.
 */
export async function assertMigrated(
  prisma: Db,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<void> {
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass(quote_ident(current_schema()) || '._prisma_migrations') IS NOT NULL AS present`;
  if (!present) throw new ResetRefused(NOT_MIGRATED);
  const shipped = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT "migration_name" FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
  const names = new Set(applied.map((r) => r.migration_name));
  if (shipped.some((name) => !names.has(name))) throw new ResetRefused(NOT_MIGRATED);
}

/** Rows removed, per table (by its name), and the tickets among them that were checked in. */
export interface RemovedCounts {
  tables: Record<string, number>;
  checkedIn: number;
}

const quoted = (table: string): string => `"${table.replace(/"/g, '""')}"`;

/** Research R10: a lock wait, a deadlock, or a transaction that ran out of time. */
function isBusy(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2028') return true;
  const sqlState = (err.meta as { code?: unknown } | undefined)?.code;
  return err.code === 'P2010' && (sqlState === '55P03' || sqlState === '40P01');
}

/**
 * Research R2 (FR-004, FR-005): in one transaction, every table but `_prisma_migrations` listed
 * from the catalog, all locked up front, counted, and truncated in one statement. All or nothing.
 */
export async function wipeAppData(prisma: PrismaService): Promise<RemovedCounts> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);
        const tables = (
          await tx.$queryRaw<{ tablename: string }[]>`
            SELECT tablename FROM pg_tables
            WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
            ORDER BY tablename`
        ).map((r) => r.tablename);
        const removed: RemovedCounts = { tables: {}, checkedIn: 0 };
        if (tables.length === 0) return removed;
        const list = tables.map(quoted).join(', ');
        await tx.$executeRawUnsafe(`LOCK TABLE ${list} IN ACCESS EXCLUSIVE MODE`);
        for (const t of tables) {
          const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM ${quoted(t)}`,
          );
          removed.tables[t] = Number(n);
        }
        if (tables.includes('Ticket')) {
          const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM "Ticket" WHERE "checkedInAt" IS NOT NULL`;
          removed.checkedIn = Number(n);
        }
        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
        return removed;
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  } catch (err) {
    if (isBusy(err)) throw new ResetRefused(BUSY);
    throw err;
  }
}

export interface ResetSummary {
  target: ResetTarget;
  removed: RemovedCounts;
  created: DemoSummary;
  /** Demo Tonight's end: its check-in window closes then. */
  tonightClosesAt: Date;
  ms: number;
}

export interface ResetOptions {
  /** Each line of the output (R11). */
  log: (line: string) => void;
  /** The migrations the Backend ships; tests give another folder (T005). */
  migrationsDir?: string;
  /** Tests only (T006): runs between the wipe and the demo data. */
  afterWipe?: () => Promise<void>;
  /** Printed as the database worked on; defaults to DATABASE_URL's host, port, and name. */
  target?: ResetTarget;
}

/** Research R11: table names as words, in the order printed; another table under its name. */
const LABELS: [table: string, one: string, many: string][] = [
  ['Location', 'venue', 'venues'],
  ['Section', 'seating section', 'seating sections'],
  ['Event', 'event', 'events'],
  ['TicketTier', 'tier', 'tiers'],
  ['SectionTier', 'section tier', 'section tiers'],
  ['EventImage', 'image', 'images'],
  ['Order', 'order', 'orders'],
  ['Ticket', 'ticket', 'tickets'],
  ['SeatReservation', 'seat reservation', 'seat reservations'],
  ['SeatHold', 'seat hold', 'seat holds'],
];

function removedLine(removed: RemovedCounts): string {
  const known = new Set(LABELS.map(([t]) => t));
  const parts: string[] = [];
  for (const [table, one, many] of LABELS) {
    if (!(table in removed.tables)) continue;
    const n = removed.tables[table];
    parts.push(
      `${n} ${n === 1 ? one : many}` +
        (table === 'Ticket' ? ` (${removed.checkedIn} checked in)` : ''),
    );
  }
  for (const [table, n] of Object.entries(removed.tables)) {
    if (!known.has(table)) parts.push(`${n} ${table}`);
  }
  return `Removed: ${parts.join(', ')}.`;
}

/** DATABASE_URL's host, port, and name, without the guard's checks. */
function targetFromEnv(): ResetTarget {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost');
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase(),
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

const incomplete = (reason: string): ResetIncomplete =>
  new ResetIncomplete(
    `The data was removed, but the demo state is incomplete (${reason}); run it again to ` +
      'finish it.',
  );

/**
 * The reset (FR-004 to FR-007, FR-012 to FR-014): the migration check, the wipe, the demo data,
 * then the check that exactly one demo set loaded (R10). Prints as it goes (R11).
 */
export async function runDemoReset(
  app: INestApplicationContext,
  options: ResetOptions,
): Promise<ResetSummary> {
  const started = Date.now();
  const { log } = options;
  const prisma = app.get(PrismaService);
  const target = options.target ?? targetFromEnv();
  log(`Resetting ${where(target)} to the demo state.`);

  await assertMigrated(prisma, options.migrationsDir ?? MIGRATIONS_DIR);
  const removed = await wipeAppData(prisma);
  log(removedLine(removed));

  let created: DemoSummary;
  try {
    await options.afterWipe?.();
    created = await runDemoData(app);
  } catch (err) {
    throw incomplete(err instanceof Error ? err.message : String(err));
  }
  if (!created.created) throw incomplete('another reset ran at the same time');
  const [venues, arenas] = await Promise.all([
    prisma.location.count(),
    prisma.location.count({ where: { name: DEMO_VENUE } }),
  ]);
  if (venues !== 2 || arenas !== 1) throw incomplete('another reset ran at the same time');

  const tonight = await prisma.event.findFirst({
    where: { name: 'Demo Tonight' },
    include: { location: true },
  });
  if (!tonight) throw incomplete('Demo Tonight is missing');

  log(
    `Created: ${created.venues} venues, ${created.events} events (${created.cancelled} cancelled, ` +
      `${created.past} over), ${created.orders} orders, ${created.tickets} tickets ` +
      `(${created.checkedIn} checked in), ${created.images} images. Demo Tonight is open for ` +
      `check-in until ${formatTimeOfDay(tonight.endsAt, tonight.location.timeZone)}.`,
  );
  if (created.unverifiedVenues > 0) {
    log(
      'The address service was unavailable, so the demo venues were saved with their addresses ' +
        'not verified.',
    );
  }
  const ms = Date.now() - started;
  log(
    `Done in ${(ms / 1000).toFixed(1)} s. Reload any open app. Purchase attempt limits counted ` +
      'before the reset clear within a minute, or when the Backend restarts.',
  );
  return { target, removed, created, tonightClosesAt: tonight.endsAt, ms };
}

/**
 * The command (R7, R11): the guard before anything is connected to, then the Backend's module
 * (as the demo data's script), the reset, and `app.close()`. Exit status 1 on any refusal or
 * failure, with the reason.
 */
export async function main(): Promise<void> {
  let target: ResetTarget;
  try {
    target = checkResetAllowed(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await runDemoReset(app, { log: (line) => console.log(line), target });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
