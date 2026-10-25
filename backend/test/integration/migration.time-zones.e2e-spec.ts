import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Spec 020 US7, SC-001, research R6: on a database migrated up to the migration before
 * `venue_time_zones`, venues and events as they are before the feature; then the migration. Every
 * venue gets America/New_York, recorded as DEFAULT; no event's instants move by a microsecond;
 * the zone is checked and has no default; `event_no_overlap` is deferrable and still refuses an
 * overlap at once.
 */
const PRISMA_DIR = path.resolve(__dirname, '../../prisma');
const NEW_MIGRATION = readdirSync(path.join(PRISMA_DIR, 'migrations')).find((d) =>
  d.endsWith('_venue_time_zones'),
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

describe('migration venue_time_zones (R6)', () => {
  const dbName = `migration_tz_${randomUUID().slice(0, 8)}`;
  const admin = new PrismaClient();
  let url: string;
  let db: PrismaClient;
  let work: string;

  const venues = { legacy: randomUUID(), verified: randomUUID(), unverified: randomUUID() };
  const events = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

  const eventRows = () =>
    db.$queryRawUnsafe<{ id: string; s: string; e: string; status: string }[]>(
      `SELECT "id"::text AS id, "startsAt"::text AS s, "endsAt"::text AS e, "status"::text AS status
       FROM "Event" ORDER BY "id"`,
    );

  beforeAll(async () => {
    expect(NEW_MIGRATION).toBeDefined();
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const base = new URL(process.env.DATABASE_URL as string);
    base.pathname = `/${dbName}`;
    url = base.toString();

    // A copy of prisma/ without the new migration: the database as it is before 020.
    work = mkdtempSync(path.join(tmpdir(), 'qp-migration-'));
    cpSync(PRISMA_DIR, work, {
      recursive: true,
      filter: (src) => !src.includes(NEW_MIGRATION as string),
    });
    deploy(work, url);

    db = new PrismaClient({ datasourceUrl: url });
    await db.$executeRawUnsafe(`
      INSERT INTO "Location" ("id", "name", "address", "seatingCapacity", "updatedAt")
      VALUES ('${venues.legacy}', 'Old Hall', '1 Main St, Somewhere', 100, now())`);
    await db.$executeRawUnsafe(`
      INSERT INTO "Location" ("id", "name", "address", "street", "city", "state", "zip",
                              "addressVerified", "seatingCapacity", "updatedAt")
      VALUES ('${venues.verified}', 'Riverside', '430 W VINE ST, LEXINGTON, KY 40507',
              '430 W VINE ST', 'LEXINGTON', 'KY', '40507', true, 400, now()),
             ('${venues.unverified}', 'Arena', '1 Arena Plaza, Louisville, KY 40202',
              '1 Arena Plaza', 'Louisville', 'KY', '40202', false, 22000, now())`);
    const rows: [string, string, string, string, string][] = [
      [
        events[0],
        venues.legacy,
        '2026-10-01 23:00:00.123456+00',
        '2026-10-02 02:00:00.654321+00',
        'SCHEDULED',
      ],
      // Across local midnight: 10:00 PM to 1:00 AM Eastern.
      [
        events[1],
        venues.verified,
        '2026-10-02 02:00:00.000001+00',
        '2026-10-02 05:00:00.999999+00',
        'SCHEDULED',
      ],
      [events[2], venues.verified, '2027-11-07 05:30:00+00', '2027-11-07 07:30:00+00', 'SCHEDULED'],
      [
        events[3],
        venues.unverified,
        '2027-03-14 06:30:00.5+00',
        '2027-03-14 08:00:00+00',
        'SCHEDULED',
      ],
      [
        events[4],
        venues.unverified,
        '2027-03-14 06:30:00.5+00',
        '2027-03-14 08:00:00+00',
        'CANCELLED',
      ],
    ];
    for (const [id, loc, s, e, status] of rows) {
      await db.$executeRawUnsafe(`
        INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt",
                             "totalTicketCapacity", "basePrice", "status", "updatedAt")
        VALUES ('${id}', 'E', '${loc}', '${s}', '${e}', 10, 45.00, '${status}', now())`);
    }
  });

  afterAll(async () => {
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$disconnect();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('gives every venue America/New_York, DEFAULT, and moves no event', async () => {
    const before = await eventRows();
    expect(before).toHaveLength(5);

    deploy(PRISMA_DIR, url);

    const after = await eventRows();
    expect(after).toEqual(before);
    const zones = await db.$queryRawUnsafe<{ id: string; tz: string; src: string }[]>(
      `SELECT "id"::text AS id, "timeZone" AS tz, "timeZoneSource"::text AS src FROM "Location"`,
    );
    expect(zones).toHaveLength(3);
    for (const z of zones) expect([z.tz, z.src]).toEqual(['America/New_York', 'DEFAULT']);
  });

  it.each(['America/Kentucky/Louisville', 'UTC'])('refuses the zone %s (CHECK)', async (zone) => {
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "Location" SET "timeZone" = '${zone}' WHERE "id" = '${venues.verified}'`,
      ),
    ).rejects.toThrow(/location_time_zone_known/);
  });

  it('has no default: an insert without timeZone fails', async () => {
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO "Location" ("id", "name", "address", "seatingCapacity", "updatedAt", "timeZoneSource")
        VALUES ('${randomUUID()}', 'New', 'x', 10, now(), 'ADMIN')`),
    ).rejects.toThrow(/timeZone/);
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO "Location" ("id", "name", "address", "seatingCapacity", "updatedAt", "timeZone")
        VALUES ('${randomUUID()}', 'New', 'x', 10, now(), 'America/Chicago')`),
    ).rejects.toThrow(/timeZoneSource/);
  });

  it('makes event_no_overlap deferrable, initially immediate', async () => {
    const [c] = await db.$queryRawUnsafe<{ d: boolean; i: boolean }[]>(
      `SELECT condeferrable AS d, condeferred AS i FROM pg_constraint WHERE conname = 'event_no_overlap'`,
    );
    expect(c).toEqual({ d: true, i: false });
  });

  it('still refuses an overlapping insert at once', async () => {
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt",
                             "totalTicketCapacity", "basePrice", "updatedAt")
        VALUES ('${randomUUID()}', 'Overlap', '${venues.legacy}', '2026-10-02 00:00:00+00',
                '2026-10-02 01:00:00+00', 10, 45.00, now())`),
    ).rejects.toThrow(/event_no_overlap/);
  });
});
