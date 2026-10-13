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
      events: 3,
      cancelled: 'Holiday Gala',
      unverifiedVenues: 0,
    });
    expect(summary.orders).toBeGreaterThan(30);
    expect(summary.checkedIn).toBeGreaterThan(0);

    const report = (await asAdmin(ctx).get('/reports/sales').expect(200)).body;
    expect(report.totals.events).toBe(2);
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

  it('changes nothing when run again', async () => {
    const before = await ctx.prisma.order.count();
    const again = await runDemoData(ctx.app);
    expect(again.created).toBe(false);
    expect(await ctx.prisma.order.count()).toBe(before);
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
          events: 3,
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
