import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DOORS_OPEN_MAX_BEFORE_START_MINUTES } from '@queuepass/shared';

/**
 * Spec 025 FR-024, SC-004, research R1, R2 (T004): on a database migrated up to the migration
 * before `doors_open`, a scheduled future event, a scheduled past event, and a cancelled event;
 * then the migration. Every event opens its doors 1 hour before its start, so its check-in window
 * is unchanged; the column is NOT NULL with no default; the `event_doors_open_range` CHECK refuses
 * both sides of the range and states the same 6 hours as the shared constant.
 */
const PRISMA_DIR = path.resolve(__dirname, '../../prisma');
const NEW_MIGRATION = readdirSync(path.join(PRISMA_DIR, 'migrations')).find((d) =>
  d.endsWith('_doors_open'),
);

function deploy(schemaDir: string, url: string): void {
  execFileSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', path.join(schemaDir, 'schema.prisma')],
    {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32',
    },
  );
}

describe('migration doors_open (R1)', () => {
  const dbName = `migration_doors_${randomUUID().slice(0, 8)}`;
  const admin = new PrismaClient();
  let url: string;
  let db: PrismaClient;
  let work: string;

  const venue = randomUUID();
  const events = { future: randomUUID(), past: randomUUID(), cancelled: randomUUID() };

  const setDoors = (id: string, expression: string) =>
    db.$executeRawUnsafe(`UPDATE "Event" SET "doorsOpenAt" = ${expression} WHERE "id" = '${id}'`);

  beforeAll(async () => {
    expect(NEW_MIGRATION).toBeDefined();
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const base = new URL(process.env.DATABASE_URL as string);
    base.pathname = `/${dbName}`;
    url = base.toString();

    // A copy of prisma/ without the new migration: the database as it is before 025.
    work = mkdtempSync(path.join(tmpdir(), 'qp-migration-'));
    cpSync(PRISMA_DIR, work, {
      recursive: true,
      filter: (src) => !src.includes(NEW_MIGRATION as string),
    });
    deploy(work, url);

    db = new PrismaClient({ datasourceUrl: url });
    await db.$executeRawUnsafe(`
      INSERT INTO "Location" ("id", "name", "address", "seatingCapacity", "updatedAt", "timeZone",
                              "timeZoneSource")
      VALUES ('${venue}', 'Hall', '1 Main St, Somewhere', 100, now(), 'America/New_York',
              'DEFAULT')`);
    const rows: [string, string, string, string][] = [
      [events.future, '2027-01-15 00:00:00.123456+00', '2027-01-15 03:00:00+00', 'SCHEDULED'],
      [events.past, '2026-01-15 00:00:00+00', '2026-01-15 03:00:00+00', 'SCHEDULED'],
      [events.cancelled, '2027-02-15 00:00:00+00', '2027-02-15 03:00:00+00', 'CANCELLED'],
    ];
    for (const [id, s, e, status] of rows) {
      await db.$executeRawUnsafe(`
        INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt",
                             "totalTicketCapacity", "basePrice", "status", "cancelledAt", "updatedAt")
        VALUES ('${id}', 'E', '${venue}', '${s}', '${e}', 10, 45.00, '${status}',
                ${status === 'CANCELLED' ? 'now()' : 'NULL'}, now())`);
    }
    deploy(PRISMA_DIR, url);
  });

  afterAll(async () => {
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$disconnect();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('gives every event, scheduled, past, or cancelled, doors exactly 1 hour before its start', async () => {
    const rows = await db.$queryRawUnsafe<{ id: string; gap: string }[]>(
      `SELECT "id"::text AS id, ("startsAt" - "doorsOpenAt")::text AS gap FROM "Event"`,
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.gap).toBe('01:00:00');
  });

  it('makes the column NOT NULL with no default', async () => {
    const [c] = await db.$queryRawUnsafe<{ nullable: string; dflt: string | null }[]>(
      `SELECT is_nullable AS nullable, column_default AS dflt FROM information_schema.columns
       WHERE table_name = 'Event' AND column_name = 'doorsOpenAt'`,
    );
    expect(c).toEqual({ nullable: 'NO', dflt: null });
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt",
                             "totalTicketCapacity", "basePrice", "updatedAt")
        VALUES ('${randomUUID()}', 'No Doors', '${venue}', '2027-06-01 00:00:00+00',
                '2027-06-01 03:00:00+00', 10, 45.00, now())`),
    ).rejects.toThrow(/23502/); // not_null_violation
  });

  it('refuses doors 1 second after the start and 6 hours 1 second before it (CHECK)', async () => {
    await expect(setDoors(events.future, `"startsAt" + interval '1 second'`)).rejects.toThrow(
      /event_doors_open_range/,
    );
    await expect(
      setDoors(events.future, `"startsAt" - interval '6 hours' - interval '1 second'`),
    ).rejects.toThrow(/event_doors_open_range/);
  });

  it('allows doors at the start and exactly 6 hours before it', async () => {
    await expect(setDoors(events.future, `"startsAt"`)).resolves.toBe(1);
    await expect(setDoors(events.future, `"startsAt" - interval '6 hours'`)).resolves.toBe(1);
  });

  it('states the same 6 hours as DOORS_OPEN_MAX_BEFORE_START_MINUTES', async () => {
    const [c] = await db.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'event_doors_open_range'`,
    );
    expect(c.def).toContain("'06:00:00'");
    const hours = String(DOORS_OPEN_MAX_BEFORE_START_MINUTES / 60).padStart(2, '0');
    expect(c.def).toContain(`'${hours}:00:00'::interval`);
  });
});
