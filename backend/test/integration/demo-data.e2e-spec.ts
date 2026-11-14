import { localDate, sniffImageType, toLocalDateTime } from '@queuepass/shared';
import { runDemoData } from '../../src/scripts/demo-data';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 038 research R18: the venue the demo's seated events are at. */
const YUM = 'KFC Yum! Center';

/** R18 and T045: the Yum! Center's four layouts, in the order imported. */
const LAYOUTS = [
  { name: 'Basketball', seats: 22_090, sections: 54, levels: 4, eventsUsing: 2, locked: true },
  {
    name: 'End-stage concert',
    seats: 17_500,
    sections: 42,
    levels: 3,
    eventsUsing: 1,
    locked: true,
  },
  { name: 'Center stage', seats: 19_500, sections: 48, levels: 3, eventsUsing: 0, locked: false },
  {
    name: 'Wrestling (ring)',
    seats: 18_000,
    sections: 43,
    levels: 3,
    eventsUsing: 1,
    locked: true,
  },
];

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

/**
 * R18's demo events table: each event's layout, its level prices by level name (a level left out
 * has no price), and the seats off sale as sections, with only some of their rows when `rows` is
 * given (by label).
 */
const SEATED: {
  name: string;
  layout: string;
  prices: Record<string, string>;
  offSale: { sections: string[]; rows?: string[] } | null;
}[] = [
  {
    name: 'Cardinals Women vs. Duke',
    layout: 'Basketball',
    prices: { Courtside: '95.00', 'Lower sideline': '60.00', 'Lower end': '35.00' },
    offSale: { sections: range(301, 330) },
  },
  {
    name: 'Cardinals Men vs. Kentucky',
    layout: 'Basketball',
    prices: {
      Courtside: '150.00',
      'Lower sideline': '90.00',
      'Lower end': '55.00',
      Upper: '25.00',
    },
    offSale: null,
  },
  {
    name: 'Arena Tour: Live',
    layout: 'End-stage concert',
    prices: { Floor: '120.00', Lower: '75.00', Upper: '40.00' },
    offSale: null,
  },
  {
    name: 'WWE Saturday Night',
    layout: 'Wrestling (ring)',
    prices: { Floor: '110.00', Lower: '65.00', Upper: '30.00' },
    offSale: {
      sections: [...range(305, 310), ...range(320, 325)],
      rows: ['S', 'T', 'U', 'V', 'W'],
    },
  },
];

/** Spec 005 FR-013: the demo-data command obeys every rule and is safe to run twice. */
describe('Demo data', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    ctx.geocoder.reset();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates venues, events, tiers, orders, check-ins, and one cancelled event', async () => {
    const summary = await runDemoData(ctx.app);
    expect(summary).toMatchObject({
      created: true,
      // Spec 038 (FR-033, research R18): the KFC Yum! Center joins the two.
      venues: 3,
      // Spec 017: Demo Tonight joins the three (research R13); spec 029: Season Opener (R5);
      // spec 038: the Yum! Center's four (R18).
      events: 9,
      layouts: LAYOUTS.map(({ name, seats }) => ({ name, seats })),
      cancelled: 'Holiday Gala',
      past: 'Season Opener',
      unverifiedVenues: 0,
      // Spec 014 research R15: 3 on the concert and 1 on the comedy night. (R15 and T039 say 6,
      // which does not match 3 + 1 + 0; the summary counts what was made.)
      images: 4,
    });
    expect(summary.orders).toBeGreaterThan(30);
    expect(summary.checkedIn).toBeGreaterThan(0);

    const report = (await asAdmin(ctx).get('/reports/sales').expect(200)).body;
    // Scheduled events: the gala is cancelled (spec 029 research R5).
    expect(report.totals.events).toBe(8);
    expect(report.totals.ticketsSold).toBeGreaterThan(0);
    expect(report.totals.checkedIn).toBe(summary.checkedIn);
    const gala = report.events.find((e: { name: string }) => e.name === 'Holiday Gala');
    expect(gala).toMatchObject({ status: 'CANCELLED', ticketsSold: 0, revenue: '0.00' });
    // Spec 016 research R10: one event shows the per-customer limit live.
    const limited = await ctx.prisma.event.findMany({
      where: { maxTicketsPerCustomer: { not: null } },
    });
    expect(limited.map((e) => [e.name, e.maxTicketsPerCustomer])).toEqual([['Comedy Night', 4]]);
    for (const e of report.events) {
      expect(e.ticketsSold).toBeLessThanOrEqual(e.ticketCapacity);
      for (const t of e.tiers) expect(t.ticketsSold).toBeLessThanOrEqual(t.quantity);
    }
  });

  /** Spec 017 FR-006 (T032): every demo order carries a holder's name, from the fixed list. */
  it('gives every demo order a holder name', async () => {
    // Created by the first test of this file.
    const orders = await ctx.prisma.order.findMany({ select: { holderName: true } });
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      expect(typeof o.holderName).toBe('string');
      expect((o.holderName as string).length).toBeGreaterThan(0);
    }
    expect(new Set(orders.map((o) => o.holderName)).size).toBeGreaterThan(5);
  });

  /** Spec 017 FR-006, research R13 (T044): an event whose entry window is open right away. */
  it('creates Demo Tonight with its entry window open right after loading, with unused tickets', async () => {
    // Created by the first test of this file.
    const rows = await ctx.prisma.$queryRaw<
      { id: string; open: boolean; startsAt: Date }[]
      // Spec 025 FR-011: the window opens 1 hour before doors open.
    >`SELECT "id", now() >= "doorsOpenAt" - interval '1 hour' AND now() < "endsAt" AS "open", "startsAt"
      FROM "Event" WHERE "name" = 'Demo Tonight'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].open).toBe(true);
    const unused = await ctx.prisma.ticket.count({
      where: { eventId: rows[0].id, status: 'VALID', checkedInAt: null },
    });
    expect(unused).toBeGreaterThan(4);
    // One order of 4, for Admit all 4 (research R13).
    const orders = await ctx.prisma.order.groupBy({
      by: ['quantity'],
      where: { eventId: rows[0].id },
    });
    expect(orders.map((o) => o.quantity)).toContain(4);
  });

  /** Spec 025 research R11 (T024): demo events take the default doors, start minus 1 hour. */
  it('gives every demo event doors 1 hour before its start, and Demo Tonight open for entry', async () => {
    const events = await ctx.prisma.event.findMany();
    expect(events.length).toBe(9);
    for (const e of events) {
      expect(e.startsAt.getTime() - e.doorsOpenAt.getTime()).toBe(3_600_000);
    }
    const listed = await asAdmin(ctx).get('/events').expect(200);
    const tonight = listed.body.find((e: { name: string }) => e.name === 'Demo Tonight');
    expect(Date.parse(tonight.entryOpensAt)).toBeLessThan(Date.now());
  });

  /** Spec 017 research R13 (T044): the demo check-ins record an agent, like real entries. */
  it('records demo-agent1 / agent1 on the check-ins the demo data makes', async () => {
    const checkedIn = await ctx.prisma.ticket.findMany({ where: { checkedInAt: { not: null } } });
    expect(checkedIn.length).toBeGreaterThan(0);
    for (const t of checkedIn) {
      expect(t.checkedInBySub).toBe('demo-agent1');
      expect(t.checkedInByUsername).toBe('agent1');
    }
  });

  /**
   * Spec 014 FR-034 (research R15): generated pictures, through the image rules: several on the
   * concert, one on the comedy night, none on the gala.
   */
  it('adds generated images: 3 to the concert, 1 to the comedy night, none to the gala', async () => {
    // Created by the first test of this file.
    const byEvent = await ctx.prisma.event.findMany({
      where: { name: { in: ['Fall Concert', 'Comedy Night', 'Holiday Gala'] } },
      select: {
        name: true,
        images: { select: { position: true, bytes: true }, orderBy: { position: 'asc' } },
      },
    });
    const count = Object.fromEntries(byEvent.map((e) => [e.name, e.images.length]));
    expect(count).toEqual({ 'Fall Concert': 3, 'Comedy Night': 1, 'Holiday Gala': 0 });
    const all = byEvent.flatMap((e) => e.images);
    expect(await ctx.prisma.eventImage.count()).toBe(all.length);
    for (const image of all) {
      expect(sniffImageType(image.bytes)).toBe('image/png');
      expect(image.bytes.length).toBeLessThan(100 * 1024);
    }
    // Three different pictures on the concert, so its rotation shows.
    const concert = byEvent.find((e) => e.name === 'Fall Concert')!;
    expect(new Set(concert.images.map((i) => Buffer.from(i.bytes).toString('base64'))).size).toBe(
      3,
    );
  });

  /**
   * Spec 029 FR-007 (research R5, T002): an event that is over, at the Hall, 7:00 PM to 10:00 PM
   * local on the run's local date minus 7 days, scheduled, with no orders or tickets.
   */
  it('creates Season Opener, over, at the Hall a week before the run, with no tickets', async () => {
    // Created by the first test of this file.
    const opener = await ctx.prisma.event.findFirstOrThrow({
      where: { name: 'Season Opener' },
      include: { location: true, _count: { select: { orders: true, tickets: true } } },
    });
    const zone = opener.location.timeZone;
    expect(opener.location.name).toBe('Demo Riverside Hall');
    expect(opener.status).toBe('SCHEDULED');
    expect(opener._count).toEqual({ orders: 0, tickets: 0 });
    const [y, m, d] = localDate(new Date(), zone).split('-').map(Number);
    const weekAgo = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
    expect(toLocalDateTime(opener.startsAt, zone)).toBe(`${weekAgo}T19:00`);
    expect(toLocalDateTime(opener.endsAt, zone)).toBe(`${weekAgo}T22:00`);
    const [{ over }] = await ctx.prisma.$queryRaw<{ over: boolean }[]>`
      SELECT "endsAt" < now() AS "over" FROM "Event" WHERE "id" = ${opener.id}::uuid`;
    expect(over).toBe(true);
  });

  /**
   * Spec 038 US5 (FR-033, SC-008; research R18; T046): the KFC Yum! Center, its four layouts from
   * the committed files, and its four events with their prices, seats off sale and sold seats.
   * Created by the first test of this file.
   */
  describe('the KFC Yum! Center (spec 038)', () => {
    /** Per section and row label, how many of `ids`' seats (or the layout's, when filtered). */
    type RowCount = { section: string; row: string; n: number };
    const rowCounts = (rows: { section: string; row: string; n: bigint }[]): RowCount[] =>
      rows
        .map((r) => ({ section: r.section, row: r.row, n: Number(r.n) }))
        .sort((a, b) => `${a.section} ${a.row}`.localeCompare(`${b.section} ${b.row}`));

    it('is at 1 Arena Plaza, verified, with capacity 22,090 (its largest layout)', async () => {
      const yum = await ctx.prisma.location.findFirstOrThrow({ where: { name: YUM } });
      expect(yum).toMatchObject({
        address: '1 ARENA PLAZA, LOUISVILLE, KY 40202',
        addressVerified: true,
        seatingCapacity: 22_090,
        timeZone: 'America/New_York',
      });
    });

    it('has exactly the four layouts, with their seats, used and locked as R18 says', async () => {
      const yum = await ctx.prisma.location.findFirstOrThrow({ where: { name: YUM } });
      const listed = (await asAdmin(ctx).get(`/locations/${yum.id}/layouts`).expect(200)).body;
      expect(
        listed
          .map(
            (l: {
              name: string;
              source: string;
              seatCount: number;
              sectionCount: number;
              levelCount: number;
              eventsUsing: number;
              locked: boolean;
            }) => ({
              name: l.name,
              source: l.source,
              seats: l.seatCount,
              sections: l.sectionCount,
              levels: l.levelCount,
              eventsUsing: l.eventsUsing,
              locked: l.locked,
            }),
          )
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)),
      ).toEqual(
        LAYOUTS.map((l) => ({ ...l, source: 'FILE' })).sort((a, b) => a.name.localeCompare(b.name)),
      );
      // Each layout's seats are all there, as the files have them.
      const seats = await ctx.prisma.$queryRaw<{ name: string; n: bigint }[]>`
        SELECT l."name", count(s."id") AS n FROM "Layout" l
        JOIN "Section" sec ON sec."layoutId" = l."id" JOIN "Seat" s ON s."sectionId" = sec."id"
        WHERE l."locationId" = ${yum.id}::uuid GROUP BY l."name"`;
      expect(Object.fromEntries(seats.map((r) => [r.name, Number(r.n)]))).toEqual(
        Object.fromEntries(LAYOUTS.map((l) => [l.name, l.seats])),
      );
      // Basketball's levels, pinned by R18.
      const levels = await ctx.prisma.priceLevel.findMany({
        where: { layout: { locationId: yum.id, name: 'Basketball' } },
        orderBy: { rank: 'asc' },
        select: { name: true, rank: true, color: true },
      });
      expect(levels).toEqual([
        { name: 'Courtside', rank: 1, color: 'violet' },
        { name: 'Lower sideline', rank: 2, color: 'blue' },
        { name: 'Lower end', rank: 3, color: 'teal' },
        { name: 'Upper', rank: 4, color: 'green' },
      ]);
    });

    it('leaves the other demo venues without a layout, and their events unseated', async () => {
      const others = await ctx.prisma.location.findMany({
        where: { name: { not: YUM } },
        include: { _count: { select: { layouts: true } } },
      });
      expect(others.map((v) => [v.name, v._count.layouts]).sort()).toEqual([
        ['Demo Riverside Hall', 0],
        ['QueuePass Demo Arena', 0],
      ]);
      const seated = await ctx.prisma.event.findMany({
        where: { reservedSeating: true },
        select: { name: true },
      });
      expect(seated.map((e) => e.name).sort()).toEqual(SEATED.map((e) => e.name).sort());
    });

    describe.each(SEATED)('$name', ({ name, layout, prices, offSale }) => {
      const find = () =>
        ctx.prisma.event.findFirstOrThrow({
          where: { name },
          include: { location: true, layout: true },
        });

      it('is upcoming at the Yum! Center on its layout, with its level prices', async () => {
        const event = await find();
        expect(event.location.name).toBe(YUM);
        expect(event.layout?.name).toBe(layout);
        expect(event).toMatchObject({
          status: 'SCHEDULED',
          reservedSeating: true,
          maxTicketsPerCustomer: null,
        });
        expect(event.startsAt.getTime()).toBeGreaterThan(Date.now());
        const rows = await ctx.prisma.eventLevelPrice.findMany({
          where: { eventId: event.id },
          include: { level: true },
        });
        expect(Object.fromEntries(rows.map((r) => [r.level.name, r.price.toFixed(2)]))).toEqual(
          prices,
        );
        // R9: the base price is the lowest level price.
        const lowest = Math.min(...Object.values(prices).map(Number));
        expect(event.basePrice.toNumber()).toBe(lowest);
      });

      it('has exactly its seats off sale, and its capacity is the seats on sale', async () => {
        const event = await find();
        const off = rowCounts(
          await ctx.prisma.$queryRaw<{ section: string; row: string; n: bigint }[]>`
            SELECT sec."name" AS "section", r."label" AS "row", count(*) AS n
            FROM "EventOffSaleSeat" o
            JOIN "Seat" s ON s."id" = o."seatId"
            JOIN "SeatRow" r ON r."id" = s."rowId"
            JOIN "Section" sec ON sec."id" = s."sectionId"
            WHERE o."eventId" = ${event.id}::uuid
            GROUP BY 1, 2`,
        );
        const expected = offSale
          ? rowCounts(
              await ctx.prisma.$queryRaw<{ section: string; row: string; n: bigint }[]>`
                SELECT sec."name" AS "section", r."label" AS "row", count(*) AS n
                FROM "Section" sec
                JOIN "SeatRow" r ON r."sectionId" = sec."id"
                JOIN "Seat" s ON s."rowId" = r."id"
                WHERE sec."layoutId" = ${event.layoutId}::uuid
                  AND sec."name" = ANY(${offSale.sections})
                  AND (${offSale.rows ?? null}::text[] IS NULL OR r."label" = ANY(${offSale.rows ?? []}))
                GROUP BY 1, 2`,
            )
          : [];
        expect(off).toEqual(expected);
        if (offSale) {
          // Every section named is in the layout, and every row named in each of them.
          expect(new Set(off.map((r) => r.section)).size).toBe(offSale.sections.length);
          if (offSale.rows) expect(off).toHaveLength(offSale.sections.length * offSale.rows.length);
        }
        const offCount = off.reduce((a, r) => a + r.n, 0);
        expect(event.totalTicketCapacity).toBe(event.layout!.seatCount - offCount);
      });

      it('has about 40 seats sold through a hold and an order each, none held now', async () => {
        const event = await find();
        const tickets = await ctx.prisma.$queryRaw<
          {
            seatId: string | null;
            status: string;
            price: string;
            levelName: string | null;
            seatSection: string | null;
            seatRowLabel: string | null;
            seatLabel: string | null;
            section: string;
            rowLabel: string;
            label: string;
            level: string;
            levelPrice: string | null;
            offSale: boolean;
          }[]
        >`
          SELECT t."seatId"::text AS "seatId", t."status"::text AS "status", t."price"::text AS "price",
                 t."levelName", t."seatSection", t."seatRowLabel", t."seatLabel",
                 sec."name" AS "section", r."label" AS "rowLabel", s."label",
                 lv."name" AS "level", p."price"::text AS "levelPrice",
                 EXISTS (SELECT 1 FROM "EventOffSaleSeat" o
                         WHERE o."eventId" = t."eventId" AND o."seatId" = s."id") AS "offSale"
          FROM "Ticket" t
          JOIN "Seat" s ON s."id" = t."seatId"
          JOIN "SeatRow" r ON r."id" = s."rowId"
          JOIN "Section" sec ON sec."id" = s."sectionId"
          JOIN "PriceLevel" lv ON lv."id" = COALESCE(s."levelId", r."levelId", sec."levelId")
          LEFT JOIN "EventLevelPrice" p ON p."eventId" = t."eventId" AND p."levelId" = lv."id"
          WHERE t."eventId" = ${event.id}::uuid`;
        // Every ticket of the event has a seat of its layout (the join kept them all).
        expect(await ctx.prisma.ticket.count({ where: { eventId: event.id } })).toBe(
          tickets.length,
        );
        expect(tickets.length).toBeGreaterThanOrEqual(35);
        expect(tickets.length).toBeLessThanOrEqual(45);
        expect(new Set(tickets.map((t) => t.seatId)).size).toBe(tickets.length);
        // Seats of more than one level, so the map shows sold seats across its prices.
        expect(new Set(tickets.map((t) => t.level)).size).toBeGreaterThanOrEqual(3);
        for (const t of tickets) {
          expect(t).toMatchObject({
            status: 'VALID',
            offSale: false,
            price: t.levelPrice,
            levelName: t.level,
            seatSection: t.section,
            seatRowLabel: t.rowLabel,
            seatLabel: t.label,
          });
        }

        // A hold, then an order (R18): each seat's hold ended by the purchase; none is live.
        const holds = await ctx.prisma.seatHold.findMany({ where: { eventId: event.id } });
        expect(holds).toHaveLength(tickets.length);
        for (const h of holds) {
          expect([h.releasedAt !== null, h.endReason]).toEqual([true, 'BOUGHT']);
        }
        expect(new Set(holds.map((h) => h.seatId))).toEqual(new Set(tickets.map((t) => t.seatId)));
        expect(
          await ctx.prisma.seatReservation.count({ where: { eventId: event.id, endedAt: null } }),
        ).toBe(0);

        // Orders by demo customers, each named, each total the sum of its tickets.
        const orders = await ctx.prisma.order.findMany({
          where: { eventId: event.id },
          include: { tickets: { select: { price: true } } },
        });
        expect(orders.length).toBeGreaterThan(5);
        for (const o of orders) {
          expect(o.customerSub).toMatch(/^demo-customer\d+$/);
          expect(o.holderName).toBeTruthy();
          expect(o.quantity).toBe(o.tickets.length);
          const sum = o.tickets.reduce((a, t) => a + t.price.toNumber(), 0);
          expect(o.totalPrice.toNumber()).toBe(sum);
        }
      });
    });
  });

  it('changes nothing when run again', async () => {
    const before = await ctx.prisma.order.count();
    const images = await ctx.prisma.eventImage.count();
    const again = await runDemoData(ctx.app);
    expect(again.created).toBe(false);
    expect(again.images).toBe(0);
    expect(await ctx.prisma.order.count()).toBe(before);
    expect(await ctx.prisma.eventImage.count()).toBe(images);
  });

  /** Spec 013 research R14: real addresses, and a demo that still works offline. */
  describe('venue addresses (spec 013)', () => {
    const venues = () =>
      ctx.prisma.location.findMany({
        where: { name: { in: ['Demo Riverside Hall', 'QueuePass Demo Arena'] } },
        orderBy: { name: 'asc' },
      });

    it('gives both venues real addresses, verified, the Hall first', async () => {
      // Created by the first test of this file, with the fake matching.
      const [hall, arena] = await venues();
      expect(hall).toMatchObject({
        name: 'Demo Riverside Hall',
        address: '430 W VINE ST, LEXINGTON, KY 40507',
        addressVerified: true,
      });
      expect(arena).toMatchObject({
        name: 'QueuePass Demo Arena',
        address: '937 PHILLIPS LN, LOUISVILLE, KY 40209',
        addressVerified: true,
      });
      expect(hall.createdAt.getTime()).toBeLessThanOrEqual(arena.createdAt.getTime());
    });

    /** Spec 020 research R19: online, both get Eastern from their verified addresses. */
    it('gives both venues Eastern time, from the address', async () => {
      // Created by the first test of this file, with the fake matching (placed in Lexington).
      for (const v of await venues()) {
        expect([v.name, v.timeZone, v.timeZoneSource]).toEqual([
          v.name,
          'America/New_York',
          'ADDRESS',
        ]);
      }
    });

    /**
     * Spec 020 research R19: the concert, comedy night, and gala start at 7:00 PM, 8:00 PM, and
     * 7:00 PM Eastern on their dates, whatever the season, and end 3 hours later; Demo Tonight
     * still starts about an hour after the run.
     */
    it('schedules the demo events at round local times in the venue zone', async () => {
      const events = await ctx.prisma.event.findMany({ include: { location: true } });
      const local = (name: string) => {
        const e = events.find((x) => x.name === name)!;
        return {
          start: toLocalDateTime(e.startsAt, e.location.timeZone).slice(11),
          hours: (e.endsAt.getTime() - e.startsAt.getTime()) / 3_600_000,
        };
      };
      expect(local('Fall Concert')).toEqual({ start: '19:00', hours: 3 });
      expect(local('Comedy Night')).toEqual({ start: '20:00', hours: 3 });
      expect(local('Holiday Gala')).toEqual({ start: '19:00', hours: 3 });
      // Spec 029 FR-007 (research R5): Season Opener, 7:00 PM to 10:00 PM at the Hall.
      expect(local('Season Opener')).toEqual({ start: '19:00', hours: 3 });
      // Spec 038 (research R18): the Yum! Center's four, upcoming.
      expect(local('Cardinals Women vs. Duke')).toEqual({ start: '19:00', hours: 3 });
      expect(local('Cardinals Men vs. Kentucky')).toEqual({ start: '19:00', hours: 3 });
      expect(local('Arena Tour: Live')).toEqual({ start: '20:00', hours: 3 });
      expect(local('WWE Saturday Night')).toEqual({ start: '19:30', hours: 3 });
      for (const { name } of SEATED) {
        expect(events.find((e) => e.name === name)!.startsAt.getTime()).toBeGreaterThan(Date.now());
      }
      const tonight = events.find((e) => e.name === 'Demo Tonight')!;
      const inMinutes = (tonight.startsAt.getTime() - Date.now()) / 60_000;
      // An hour after the run, which happened earlier in this file.
      expect(inMinutes).toBeLessThanOrEqual(60);
      expect(inMinutes).toBeGreaterThan(0);
      // Review round 2, m1: on the whole minute, so an edit form never sees seconds.
      expect(tonight.startsAt.getTime() % 60_000).toBe(0);
      expect(tonight.endsAt.getTime() % 60_000).toBe(0);
    });

    it('completes while the address service is down, saving the venues not verified', async () => {
      await resetDb(ctx.prisma);
      ctx.geocoder.reset();
      ctx.geocoder.always({ kind: 'unavailable' });
      try {
        const summary = await runDemoData(ctx.app);
        expect(summary).toMatchObject({
          created: true,
          venues: 3,
          events: 9,
          cancelled: 'Holiday Gala',
          past: 'Season Opener',
          unverifiedVenues: 3,
        });
        // Spec 038 (research R18): the Yum! Center between the Hall and the Arena, the marker.
        expect(ctx.geocoder.calls.map((c) => c.street)).toEqual([
          '430 W Vine St',
          '1 Arena Plaza',
          '937 Phillips Ln',
        ]);
        // Offline, the Yum! Center still gets its layouts and its four events with sold seats.
        const yum = await ctx.prisma.location.findFirstOrThrow({ where: { name: YUM } });
        expect(yum).toMatchObject({
          address: '1 Arena Plaza, Louisville, KY 40202',
          addressVerified: false,
          seatingCapacity: 22_090,
        });
        expect(await ctx.prisma.layout.count({ where: { locationId: yum.id } })).toBe(4);
        for (const { name } of SEATED) {
          const sold = await ctx.prisma.ticket.count({
            where: { event: { name }, status: 'VALID' },
          });
          expect([name, sold >= 35 && sold <= 45]).toEqual([name, true]);
        }
        const [hall, arena] = await venues();
        expect(hall).toMatchObject({
          address: '430 W Vine St, Lexington, KY 40507',
          addressVerified: false,
        });
        expect(arena).toMatchObject({
          address: '937 Phillips Ln, Louisville, KY 40209',
          addressVerified: false,
        });
        // Spec 020 research R19: Kentucky has two zones; offline, demo data takes the default.
        for (const v of [hall, arena]) {
          expect([v.timeZone, v.timeZoneSource]).toEqual(['America/New_York', 'DEFAULT']);
        }

        // The API rule is unchanged: a request is still refused (FR-006).
        const res = await asAdmin(ctx)
          .post('/locations')
          .send({ name: 'Walk-in Hall', ...ADDRESS, seatingCapacity: 10 })
          .expect(503);
        expect(res.body.error.code).toBe('ADDRESS_SERVICE_UNAVAILABLE');

        // Spec 020 research R19: no request can use the default fallback either: a Kentucky
        // address saved anyway still needs a zone.
        ctx.geocoder.reset();
        ctx.geocoder.always({ kind: 'none' });
        const refused = await asAdmin(ctx)
          .post('/locations')
          .send({
            name: 'Walk-in Hall',
            ...ADDRESS,
            seatingCapacity: 10,
            acceptUnverifiedAddress: true,
          })
          .expect(400);
        expect(refused.body.error.code).toBe('TIME_ZONE_REQUIRED');
      } finally {
        ctx.geocoder.reset();
      }
    });
  });
});
