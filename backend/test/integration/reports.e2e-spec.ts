import { asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, tier, venue, windowAt } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 020: a venue placed in Phoenix by the fake address service (Arizona time). */
async function phoenixVenue(ctx: TestContext, name = 'Phoenix Hall'): Promise<string> {
  ctx.geocoder.placeAt(PLACES.phoenix);
  const res = await asAdmin(ctx)
    .post('/locations')
    .send({
      name,
      street: '201 E Jefferson St',
      city: 'Phoenix',
      state: 'AZ',
      zip: '85004',
      seatingCapacity: 500,
    })
    .expect(201);
  ctx.geocoder.reset();
  return res.body.id;
}

/** Spec 005 US2 (FR-005): the sales report, compared with the data it summarizes. */
describe('Sales report', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  const buy = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, ...body })
      .expect(201);

  it('is empty with no events', async () => {
    const res = await asAdmin(ctx).get('/reports/sales').expect(200);
    expect(res.body.totals).toEqual({
      events: 0,
      ticketCapacity: 0,
      ticketsSold: 0,
      checkedIn: 0,
      revenue: '0.00',
    });
    expect(res.body.events).toEqual([]);
  });

  it('totals and breaks down sales by event and tier, excluding refunds and cancelled capacity', async () => {
    const yum = await venue(ctx, 'Yum Center');
    const freedom = await venue(ctx, 'Freedom Hall');
    // Created out of order to prove the report sorts by start time.
    const later = await event(ctx, freedom, {
      name: 'Later',
      capacity: 50,
      basePrice: '20.00',
      ...windowAt(424),
    });
    const opener = await event(ctx, yum, {
      name: 'Opener',
      capacity: 100,
      ...windowAt(396),
    });
    const gone = await event(ctx, yum, {
      name: 'Gone',
      capacity: 30,
      basePrice: '5.00',
      ...windowAt(455),
    });
    const general = await tier(ctx, opener, 'General', '45.00', 80);
    const vip = await tier(ctx, opener, 'VIP', '120.50', 20);

    const g = await buy(opener, { tierId: general, quantity: 3 }, 1); // 135.00
    await buy(opener, { tierId: vip, quantity: 2 }, 2); // 241.00
    await buy(later, { quantity: 4 }, 3); // 80.00
    await buy(gone, { quantity: 2 }, 4); // refunded by the cancel below
    await asAdmin(ctx).post(`/events/${gone}/cancel`).expect(200);

    // Check two of the General tickets in (no check-in operation exists yet; see research R9).
    await ctx.prisma.ticket.updateMany({
      where: { id: { in: g.body.tickets.slice(0, 2).map((t: { id: string }) => t.id) } },
      data: { checkedInAt: new Date() },
    });

    const res = await asAdmin(ctx).get('/reports/sales').expect(200);
    expect(res.body.totals).toEqual({
      events: 2,
      ticketCapacity: 150,
      ticketsSold: 9,
      checkedIn: 2,
      revenue: '456.00',
    });
    expect(res.body.events.map((e: { name: string }) => e.name)).toEqual([
      'Opener',
      'Later',
      'Gone',
    ]);

    const [o, l, c] = res.body.events;
    expect(o).toMatchObject({
      eventId: opener,
      venueName: 'Yum Center',
      // Spec 020 FR-022 (research R16).
      timeZone: 'America/New_York',
      status: 'SCHEDULED',
      ticketCapacity: 100,
      ticketsSold: 5,
      checkedIn: 2,
      revenue: '376.00',
    });
    expect(o.tiers).toEqual([
      {
        tierId: general,
        name: 'General',
        price: '45.00',
        quantity: 80,
        ticketsSold: 3,
        revenue: '135.00',
      },
      {
        tierId: vip,
        name: 'VIP',
        price: '120.50',
        quantity: 20,
        ticketsSold: 2,
        revenue: '241.00',
      },
    ]);
    expect(l).toMatchObject({ ticketsSold: 4, revenue: '80.00', tiers: [] });
    expect(c).toMatchObject({ status: 'CANCELLED', ticketsSold: 0, checkedIn: 0, revenue: '0.00' });
  });

  it('includes a new order on the next request', async () => {
    const eventId = await event(ctx, await venue(ctx));
    expect((await asAdmin(ctx).get('/reports/sales')).body.totals.ticketsSold).toBe(0);
    await buy(eventId, { quantity: 1 });
    expect((await asAdmin(ctx).get('/reports/sales')).body.totals.ticketsSold).toBe(1);
  });

  it("gives each event its venue's zone (spec 020 FR-022, R16)", async () => {
    const phoenix = await phoenixVenue(ctx);
    const id = await event(ctx, phoenix, windowAt(390, 19, 'America/Phoenix'));
    const res = await asAdmin(ctx).get('/reports/sales').expect(200);
    const line = res.body.events.find((e: { eventId: string }) => e.eventId === id);
    expect(line).toMatchObject({ venueName: 'Phoenix Hall', timeZone: 'America/Phoenix' });
  });
});
