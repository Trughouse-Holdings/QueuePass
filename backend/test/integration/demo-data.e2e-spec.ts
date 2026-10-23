import { sniffImageType } from '@queuepass/shared';
import { runDemoData } from '../../src/scripts/demo-data';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

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
      venues: 2,
      // Spec 017: Demo Tonight joins the three (research R13).
      events: 4,
      cancelled: 'Holiday Gala',
      unverifiedVenues: 0,
      // Spec 014 research R15: 3 on the concert and 1 on the comedy night. (R15 and T039 say 6,
      // which does not match 3 + 1 + 0; the summary counts what was made.)
      images: 4,
    });
    expect(summary.orders).toBeGreaterThan(30);
    expect(summary.checkedIn).toBeGreaterThan(0);

    const report = (await asAdmin(ctx).get('/reports/sales').expect(200)).body;
    expect(report.totals.events).toBe(3);
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
    >`SELECT "id", now() >= "startsAt" - interval '2 hours' AND now() < "endsAt" AS "open", "startsAt"
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

    it('completes while the address service is down, saving the venues not verified', async () => {
      await resetDb(ctx.prisma);
      ctx.geocoder.reset();
      ctx.geocoder.always({ kind: 'unavailable' });
      try {
        const summary = await runDemoData(ctx.app);
        expect(summary).toMatchObject({
          created: true,
          venues: 2,
          events: 4,
          cancelled: 'Holiday Gala',
          unverifiedVenues: 2,
        });
        expect(ctx.geocoder.calls.map((c) => c.street)).toEqual([
          '430 W Vine St',
          '937 Phillips Ln',
        ]);
        const [hall, arena] = await venues();
        expect(hall).toMatchObject({
          address: '430 W Vine St, Lexington, KY 40507',
          addressVerified: false,
        });
        expect(arena).toMatchObject({
          address: '937 Phillips Ln, Louisville, KY 40209',
          addressVerified: false,
        });

        // The API rule is unchanged: a request is still refused (FR-006).
        const res = await asAdmin(ctx)
          .post('/locations')
          .send({ name: 'Walk-in Hall', ...ADDRESS, seatingCapacity: 10 })
          .expect(503);
        expect(res.body.error.code).toBe('ADDRESS_SERVICE_UNAVAILABLE');
      } finally {
        ctx.geocoder.reset();
      }
    });
  });
});
