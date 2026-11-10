import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { localDate, toLocalDateTime } from '@queuepass/shared';
import {
  assertMigrated,
  runDemoReset,
  wipeAppData,
  type ResetSummary,
} from '../../src/scripts/demo-reset';
import { asAdmin } from '../setup/authed-request';
import { PNG, upload } from '../setup/images';
import { agent, atInstant, customer, event, HOLDER, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import type { PrismaService } from '../../src/prisma/prisma.service';

const MIGRATIONS = path.resolve(__dirname, '../../prisma/migrations');
const DEMO_VENUES = ['Demo Riverside Hall', 'QueuePass Demo Arena'];
const DEMO_EVENTS = [
  'Fall Concert',
  'Comedy Night',
  'Demo Tonight',
  'Holiday Gala',
  'Season Opener',
];
const DAY = 86_400_000;

/**
 * Spec 029 research R12 (tasks T004): every row of the demo tables reduced to what a reset must
 * reproduce. Dropped: identifiers and foreign keys, ticket codes, entry secrets, `requestId`, and
 * every timestamp but an event's start, end, and doors; a nullable timestamp only as set or not.
 * Dated events by their local date relative to the created Fall Concert's, local time, duration,
 * and doors offset; Demo Tonight by duration and doors offset only. Tickets have no link to their
 * order and no check-in; check-ins are a count per event with who checked them in (R12). Image bytes as SHA-256. Every list sorted.
 */
async function fingerprint(prisma: PrismaService) {
  const sorted = <T>(rows: T[]) => rows.map((r) => JSON.stringify(r)).sort();
  const locations = await prisma.location.findMany();
  const venueName = new Map(locations.map((l) => [l.id, l.name]));
  const events = await prisma.event.findMany({ include: { location: true } });
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const tiers = await prisma.ticketTier.findMany();
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));
  const sections = await prisma.section.findMany();
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));

  const concert = events.find((e) => e.name === 'Fall Concert');
  const refDay = concert ? Date.parse(localDate(concert.startsAt, concert.location.timeZone)) : 0;
  const minutes = (ms: number) => ms / 60_000;
  const times = (e: (typeof events)[number]) => {
    const duration = minutes(e.endsAt.getTime() - e.startsAt.getTime());
    const doors = minutes(e.startsAt.getTime() - e.doorsOpenAt.getTime());
    if (e.name === 'Demo Tonight') return { duration, doors };
    const zone = e.location.timeZone;
    return {
      day: (Date.parse(localDate(e.startsAt, zone)) - refDay) / DAY,
      time: toLocalDateTime(e.startsAt, zone).slice(11),
      duration,
      doors,
    };
  };

  return {
    locations: sorted(
      locations.map((l) => ({
        name: l.name,
        address: l.address,
        parts: [l.street, l.city, l.state, l.zip],
        verified: l.addressVerified,
        capacity: l.seatingCapacity,
        zone: l.timeZone,
        source: l.timeZoneSource,
      })),
    ),
    sections: sorted(
      sections.map((s) => ({
        venue: venueName.get(s.locationId),
        name: s.name,
        rows: s.rows,
        seatsPerRow: s.seatsPerRow,
        position: s.position,
      })),
    ),
    events: sorted(
      events.map((e) => ({
        name: e.name,
        venue: e.location.name,
        status: e.status,
        cancelled: e.cancelledAt !== null,
        capacity: e.totalTicketCapacity,
        limit: e.maxTicketsPerCustomer,
        basePrice: e.basePrice.toString(),
        reservedSeating: e.reservedSeating,
        times: times(e),
      })),
    ),
    tiers: sorted(
      tiers.map((t) => ({
        event: eventName.get(t.eventId),
        name: t.name,
        price: t.price.toString(),
        quantity: t.quantity,
      })),
    ),
    sectionTiers: sorted(
      (await prisma.sectionTier.findMany()).map((st) => ({
        event: eventName.get(st.eventId),
        section: sectionName.get(st.sectionId),
        tier: tierName.get(st.tierId),
      })),
    ),
    images: sorted(
      (await prisma.eventImage.findMany()).map((i) => ({
        event: eventName.get(i.eventId),
        position: i.position,
        type: i.contentType,
        size: i.byteSize,
        sha256: createHash('sha256').update(i.bytes).digest('hex'),
      })),
    ),
    orders: sorted(
      (await prisma.order.findMany()).map((o) => ({
        event: eventName.get(o.eventId),
        tier: o.tierId ? tierName.get(o.tierId) : null,
        customer: [o.customerSub, o.customerUsername],
        holder: o.holderName,
        quantity: o.quantity,
        prices: [o.unitPrice.toString(), o.totalPrice.toString()],
        status: o.status,
        refunded: o.refundedAt !== null,
      })),
    ),
    tickets: sorted(
      (
        await prisma.ticket.findMany({
          select: {
            eventId: true,
            tierId: true,
            status: true,
            seatSection: true,
            seatRow: true,
            seatNumber: true,
          },
        })
      ).map((t) => ({
        event: eventName.get(t.eventId),
        tier: t.tierId ? tierName.get(t.tierId) : null,
        status: t.status,
        seat: [t.seatSection, t.seatRow, t.seatNumber],
      })),
    ),
    // R12 (clarified): check-ins as a count per event, with who checked them in. Which of Fall
    // Concert's tickets are checked in follows random code order across its tiers.
    checkIns: sorted(
      (
        await prisma.ticket.groupBy({
          by: ['eventId', 'checkedInBySub', 'checkedInByUsername'],
          where: { checkedInAt: { not: null } },
          _count: { _all: true },
        })
      ).map((g) => ({
        event: eventName.get(g.eventId),
        by: [g.checkedInBySub, g.checkedInByUsername],
        count: g._count._all,
      })),
    ),
    reservations: sorted(
      (await prisma.seatReservation.findMany()).map((r) => ({
        event: eventName.get(r.eventId),
        customer: r.customerSub,
        tier: r.tierId ? tierName.get(r.tierId) : null,
        ended: r.endedAt !== null,
      })),
    ),
    holds: sorted(
      (await prisma.seatHold.findMany()).map((h) => ({
        event: eventName.get(h.eventId),
        seat: [h.seatSection, h.seatRow, h.seatNumber],
        released: h.releasedAt !== null,
        reason: h.endReason,
      })),
    ),
  };
}

/** Every table but the migration record, from the catalog, as the reset lists them. */
async function appTables(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  return rows.map((r) => r.tablename);
}

async function counts(prisma: PrismaService): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await appTables(prisma)) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`);
    out[t] = Number(row.n);
  }
  return out;
}

const migrationRows = (prisma: PrismaService) =>
  prisma.$queryRaw<unknown[]>`SELECT * FROM "_prisma_migrations" ORDER BY "migration_name"`;

describe('Demo reset (spec 029)', () => {
  let ctx: TestContext;
  const lines: string[] = [];
  const log = (line: string) => void lines.push(line);

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.geocoder.reset();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => {
    lines.length = 0;
    ctx.geocoder.reset();
  });

  /** One reset, with R12's check that Demo Tonight starts an hour after the run. */
  async function reset(): Promise<ResetSummary> {
    const runAt = Date.now();
    const summary = await runDemoReset(ctx.app, { log });
    const tonight = await ctx.prisma.event.findFirstOrThrow({ where: { name: 'Demo Tonight' } });
    const inMinutes = (tonight.startsAt.getTime() - runAt) / 60_000;
    expect(inMinutes).toBeGreaterThan(59);
    expect(inMinutes).toBeLessThanOrEqual(61);
    return summary;
  }

  /** A marker venue, made directly, that a refused reset must leave in place. */
  async function marker(): Promise<string> {
    const row = await ctx.prisma.location.create({
      data: {
        name: `Marker ${randomUUID().slice(0, 8)}`,
        address: '1 Main St, Somewhere',
        seatingCapacity: 10,
        timeZone: 'America/New_York',
        timeZoneSource: 'DEFAULT',
      },
    });
    return row.id;
  }

  /**
   * SC-001's extra data, through the services: a venue with two sections, a seated event with
   * tiers mapped to them, an unseated event in its check-in window, an image, orders by a real
   * customer, one ticket admitted, a live seat hold and an ended one.
   */
  async function fillExtraData(): Promise<void> {
    const hall = await venue(ctx, 'Extra Hall');
    const layout = await asAdmin(ctx)
      .put(`/locations/${hall}/layout`)
      .send({
        sections: [
          { name: 'Left', rows: 2, seatsPerRow: 5 },
          { name: 'Right', rows: 2, seatsPerRow: 5 },
        ],
      })
      .expect(200);
    const [left, right] = layout.body.sections.map((s: { id: string }) => s.id);

    const seated = await event(ctx, hall, { name: 'EDIS Showcase Night', capacity: 20 });
    const front = await tier(ctx, seated, 'Front', '60.00', 10);
    const back = await tier(ctx, seated, 'Back', '30.00', 10);
    await asAdmin(ctx)
      .put(`/events/${seated}/seating`)
      .send({
        reservedSeating: true,
        sections: [
          { sectionId: left, tierId: front },
          { sectionId: right, tierId: back },
        ],
      })
      .expect(200);
    await upload(ctx, seated, PNG, { contentType: 'image/png' }).expect(201);

    // A live hold (customer2) and an ended one (customer3 released it).
    await (
      await customer(ctx, 2)
    )
      .post(`/events/${seated}/reservation`)
      .send({ seats: [{ sectionId: left, row: 1, seat: 1 }] })
      .expect(201);
    await (
      await customer(ctx, 3)
    )
      .post(`/events/${seated}/reservation`)
      .send({ seats: [{ sectionId: right, row: 1, seat: 1 }] })
      .expect(201);
    await (await customer(ctx, 3)).post(`/events/${seated}/reservation/release`).send().expect(200);

    // An unseated event whose check-in window is open now (it starts in 30 minutes).
    const start = Math.floor(Date.now() / 60_000) * 60_000 + 30 * 60_000;
    const open = await event(ctx, hall, {
      name: 'Walk-in Test',
      // At most the layout's 20 seats, the venue's capacity once it has one (spec 007).
      capacity: 10,
      startsAt: atInstant(start),
      endsAt: atInstant(start + 2 * 3_600_000),
    });
    const buyer = await customer(ctx, 1);
    await buyer
      .post(`/events/${open}/orders`)
      .send({ quantity: 3, holderName: HOLDER })
      .expect(201);
    await buyer
      .post(`/events/${open}/orders`)
      .send({ quantity: 1, holderName: HOLDER })
      .expect(201);
    const ticket = await ctx.prisma.ticket.findFirstOrThrow({ where: { eventId: open } });
    await (
      await agent(ctx)
    )
      .post(`/events/${open}/entry/admit`)
      .send({ ticketId: ticket.id, wholeOrder: false })
      .expect(200);
  }

  describe('the demo state, the same every time (US1, US2; FR-004 to FR-007, SC-001, SC-003)', () => {
    let f0: Awaited<ReturnType<typeof fingerprint>>;
    let migrationsBefore: unknown[];

    beforeAll(async () => {
      await resetDb(ctx.prisma);
      migrationsBefore = await migrationRows(ctx.prisma);
    });

    it('resets an empty database to the demo state', async () => {
      const summary = await reset();
      expect(summary.created).toMatchObject({
        created: true,
        venues: 2,
        events: 5,
        past: 'Season Opener',
      });
      for (const n of Object.values(summary.removed.tables)) expect(n).toBe(0);
      f0 = await fingerprint(ctx.prisma);
      expect(f0.locations).toHaveLength(2);
      expect(f0.events).toHaveLength(5);
      expect(f0.checkIns).toEqual([
        JSON.stringify({
          event: 'Fall Concert',
          by: ['demo-agent1', 'agent1'],
          count: summary.created.checkedIn,
        }),
      ]);
    });

    it('after extra data, leaves only demo rows, equal to the empty reset (SC-001)', async () => {
      await fillExtraData();
      const before = await counts(ctx.prisma);
      expect(before.Section).toBe(2);
      expect(before.SeatHold).toBe(2);
      await reset();

      // Every table the catalog lists holds only demo rows.
      for (const table of await appTables(ctx.prisma)) {
        const columns = (
          await ctx.prisma.$queryRaw<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = ${table}`
        ).map((c) => c.column_name);
        const foreign: string[] = [];
        if (table === 'Location')
          foreign.push(`"name" NOT IN (${DEMO_VENUES.map((v) => `'${v}'`).join(', ')})`);
        if (table === 'Event')
          foreign.push(`"name" NOT IN (${DEMO_EVENTS.map((v) => `'${v}'`).join(', ')})`);
        if (columns.includes('eventId')) {
          foreign.push(
            `"eventId" NOT IN (SELECT "id" FROM "Event" WHERE "name" IN (${DEMO_EVENTS.map((v) => `'${v}'`).join(', ')}))`,
          );
        }
        if (columns.includes('locationId')) {
          foreign.push(
            `"locationId" NOT IN (SELECT "id" FROM "Location" WHERE "name" IN (${DEMO_VENUES.map((v) => `'${v}'`).join(', ')}))`,
          );
        }
        const where = foreign.length > 0 ? foreign.join(' OR ') : 'true';
        const [row] = await ctx.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "${table}" WHERE ${where}`,
        );
        expect([table, Number(row.n)]).toEqual([table, 0]);
      }

      expect(await fingerprint(ctx.prisma)).toEqual(f0);
    });

    it('gives equal fingerprints for two resets in a row (SC-003)', async () => {
      await reset();
      const first = await fingerprint(ctx.prisma);
      await reset();
      expect(await fingerprint(ctx.prisma)).toEqual(first);
      expect(first).toEqual(f0);
    });

    it('keeps the migration record as it was (FR-005)', async () => {
      expect(await migrationRows(ctx.prisma)).toEqual(migrationsBefore);
    });
  });

  describe('the migration check (US3; FR-010, SC-005)', () => {
    const fakeName = '29991231000000_not_applied';
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'qp-029-migrations-'));
      for (const name of readdirSync(MIGRATIONS)) {
        if (statSync(path.join(MIGRATIONS, name)).isDirectory()) mkdirSync(path.join(dir, name));
      }
      mkdirSync(path.join(dir, fakeName));
    });
    afterAll(async () => {
      rmSync(dir, { recursive: true, force: true });
      await ctx.prisma
        .$executeRaw`DELETE FROM "_prisma_migrations" WHERE "migration_name" = ${fakeName}`;
    });

    const NOT_MIGRATED = /not a QueuePass database, or its migrations are not all applied/;

    async function expectRefusedKeepingMarker(): Promise<void> {
      const id = await marker();
      await expect(runDemoReset(ctx.app, { log, migrationsDir: dir })).rejects.toThrow(
        NOT_MIGRATED,
      );
      expect(await ctx.prisma.location.findUnique({ where: { id } })).not.toBeNull();
    }

    it('passes with the real migrations', async () => {
      await expect(assertMigrated(ctx.prisma, MIGRATIONS)).resolves.toBeUndefined();
    });

    it('refuses a database with no _prisma_migrations', async () => {
      const name = `qp029_empty_${randomUUID().slice(0, 8)}`;
      await ctx.prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      const url = new URL(process.env.DATABASE_URL as string);
      url.pathname = `/${name}`;
      const other = new PrismaClient({ datasourceUrl: url.toString() });
      try {
        await expect(assertMigrated(other, MIGRATIONS)).rejects.toThrow(NOT_MIGRATED);
      } finally {
        await other.$disconnect();
        await ctx.prisma.$executeRawUnsafe(`DROP DATABASE "${name}"`);
      }
    });

    it('refuses when a migration the Backend ships has no row', async () => {
      await expect(assertMigrated(ctx.prisma, dir)).rejects.toThrow(NOT_MIGRATED);
      await expectRefusedKeepingMarker();
    });

    it('refuses when that migration has not finished', async () => {
      await ctx.prisma.$executeRaw`
        INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
        VALUES (${randomUUID()}, 'x', ${fakeName}, now(), 0)`;
      await expectRefusedKeepingMarker();
    });

    it('refuses when that migration was rolled back', async () => {
      await ctx.prisma.$executeRaw`
        UPDATE "_prisma_migrations" SET "finished_at" = now(), "rolled_back_at" = now()
        WHERE "migration_name" = ${fakeName}`;
      await expectRefusedKeepingMarker();
    });

    // Code review round 1, s1 (FR-010 "none failed"): a failed migration the Backend does not ship,
    // from another branch, say, still refuses, with the real migrations folder.
    it('refuses when any migration failed, even one the Backend does not ship', async () => {
      const failed = '29991231000001_failed_elsewhere';
      await ctx.prisma.$executeRaw`
        INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
        VALUES (${randomUUID()}, 'x', ${failed}, now(), 0)`;
      try {
        await expect(assertMigrated(ctx.prisma, MIGRATIONS)).rejects.toThrow(NOT_MIGRATED);
        const id = await marker();
        await expect(runDemoReset(ctx.app, { log })).rejects.toThrow(NOT_MIGRATED);
        expect(await ctx.prisma.location.findUnique({ where: { id } })).not.toBeNull();
      } finally {
        await ctx.prisma
          .$executeRaw`DELETE FROM "_prisma_migrations" WHERE "migration_name" = ${failed}`;
      }
    });
  });

  describe('the output, the time, and failures (US1; FR-012 to FR-014, SC-002)', () => {
    it('reports what it removed and created, and the reminders', async () => {
      await resetDb(ctx.prisma);
      await fillExtraData();
      const before = await counts(ctx.prisma);
      const checkedInBefore = await ctx.prisma.ticket.count({
        where: { checkedInAt: { not: null } },
      });
      const t0 = Date.now();
      const summary = await reset();
      expect(Date.now() - t0).toBeLessThan(10_000);

      expect(summary.removed.tables).toEqual(before);
      expect(summary.removed.checkedIn).toBe(checkedInBefore);
      expect(summary.removed.checkedIn).toBe(1);
      const url = new URL(process.env.DATABASE_URL as string);
      expect(summary.target).toEqual({
        host: url.hostname,
        port: Number(url.port),
        database: url.pathname.slice(1),
      });
      const credentials = `${url.username}:${url.password}@`;
      expect(Object.keys(summary.target).sort()).toEqual(['database', 'host', 'port']);

      // Created: what runDemoData's summary says, and what is there.
      const c = summary.created;
      expect(c).toMatchObject({
        created: true,
        venues: 2,
        events: 5,
        cancelled: 'Holiday Gala',
        past: 'Season Opener',
      });
      expect(await ctx.prisma.order.count()).toBe(c.orders);
      expect(await ctx.prisma.ticket.count()).toBe(c.tickets);
      expect(await ctx.prisma.ticket.count({ where: { checkedInAt: { not: null } } })).toBe(
        c.checkedIn,
      );
      expect(await ctx.prisma.eventImage.count()).toBe(c.images);

      const out = lines.join('\n');
      expect(out).not.toContain(credentials);
      expect(out).toContain(
        `Resetting ${url.hostname}:${url.port}/${url.pathname.slice(1)} to the demo state.`,
      );
      const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
      expect(out).toContain(
        `Removed: ${n(before.Location, 'venue')}, ${n(before.Section, 'seating section')}, ` +
          `${n(before.Event, 'event')}, ${n(before.TicketTier, 'tier')}, ` +
          `${n(before.SectionTier, 'section tier')}, ${n(before.EventImage, 'image')}, ` +
          `${n(before.Order, 'order')}, ${n(before.Ticket, 'ticket')} (1 checked in), ` +
          `${n(before.SeatReservation, 'seat reservation')}, ${n(before.SeatHold, 'seat hold')}.`,
      );
      expect(out).toContain(
        `Created: 2 venues, 5 events (Holiday Gala cancelled, Season Opener over), ${c.orders} orders, ` +
          `${c.tickets} tickets (${c.checkedIn} checked in), ${c.images} images.`,
      );
      const tonight = await ctx.prisma.event.findFirstOrThrow({
        where: { name: 'Demo Tonight' },
        include: { location: true },
      });
      expect(summary.tonightClosesAt).toEqual(tonight.endsAt);
      expect(out).toMatch(/Demo Tonight is open for check-in until \d{1,2}:\d{2} [AP]M E[SD]T\./);
      expect(out).toMatch(/Done in \d+\.\d s\./);
      expect(out).toContain('Reload any open app.');
      expect(out).toContain(
        'Purchase attempt limits counted before the reset clear within a minute, or when the Backend restarts.',
      );
      expect(out).not.toContain('not verified');
    });

    it('says when the address service was unavailable', async () => {
      ctx.geocoder.always({ kind: 'unavailable' });
      await reset();
      expect(lines.join('\n')).toContain('not verified');
    });

    it('wipes in under a second', async () => {
      await fillExtraData();
      const t0 = Date.now();
      await wipeAppData(ctx.prisma);
      expect(Date.now() - t0).toBeLessThan(1_000);
      for (const n of Object.values(await counts(ctx.prisma))) expect(n).toBe(0);
    });

    it('says the data was removed and the demo state is incomplete when loading fails (FR-013)', async () => {
      await expect(
        runDemoReset(ctx.app, {
          log,
          afterWipe: async () => {
            await ctx.prisma.location.create({
              data: {
                name: 'QueuePass Demo Arena',
                address: '1 Main St, Somewhere',
                seatingCapacity: 10,
                timeZone: 'America/New_York',
                timeZoneSource: 'DEFAULT',
              },
            });
          },
        }),
      ).rejects.toThrow(/removed.*incomplete.*run it again/s);
    });

    it('refuses as busy, removing nothing, while another client holds a lock (R10)', async () => {
      const id = await marker();
      const other = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holder = other.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('LOCK TABLE "Event" IN ACCESS SHARE MODE');
          locked();
          await released;
        },
        { timeout: 20_000 },
      );
      try {
        await isLocked;
        const t0 = Date.now();
        await expect(runDemoReset(ctx.app, { log })).rejects.toThrow(
          'the database is busy; try again',
        );
        const took = Date.now() - t0;
        expect(took).toBeGreaterThanOrEqual(2_500);
        expect(took).toBeLessThan(8_000);
      } finally {
        release();
        await holder;
        await other.$disconnect();
      }
      expect(await ctx.prisma.location.findUnique({ where: { id } })).not.toBeNull();
    });

    it('never leaves two demo sets when two resets run at once (R10)', async () => {
      const results = await Promise.allSettled([
        runDemoReset(ctx.app, { log }),
        runDemoReset(ctx.app, { log }),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(String((r.reason as Error).message)).toMatch(
            /removed.*incomplete.*run it again|the database is busy; try again/s,
          );
        }
      }
      if (results.every((r) => r.status === 'fulfilled')) {
        expect(await ctx.prisma.location.count()).toBe(2);
        expect(await ctx.prisma.location.count({ where: { name: 'QueuePass Demo Arena' } })).toBe(
          1,
        );
      }
      // One more run ends in the demo state (spec Edge Cases).
      await reset();
      expect(await ctx.prisma.location.count()).toBe(2);
      expect(await ctx.prisma.event.count()).toBe(5);
    });
  });
});
