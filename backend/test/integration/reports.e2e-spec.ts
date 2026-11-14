import { asAdmin } from '../setup/authed-request';
import {
  HOLDER,
  customer,
  event,
  insertLayout,
  seatEventOn,
  sellSeats,
  tier,
  venue,
  windowAt,
} from '../setup/fixtures';
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
    // Spec 038 R17: general admission has no levels.
    for (const e of res.body.events) expect(e.levels).toEqual([]);
    expect(c).toMatchObject({ status: 'CANCELLED', ticketsSold: 0, checkedIn: 0, revenue: '0.00' });
  });

  it("gives a seated event's sales by price level as sold, beside its current levels (038 R17)", async () => {
    const venueId = await venue(ctx, 'Seated Hall');
    // Courtside: 101 row A (3 seats). Lower: 101 row B and all of 102 (7). Upper: 301 (2), all off
    // sale. Box: no seats.
    const layout = await insertLayout(ctx, venueId, {
      levels: ['Courtside', 'Lower', 'Upper', 'Box'],
      sections: [
        { name: '101', level: 'Courtside', rows: 2, seatsPerRow: 3, rowLevels: { 2: 'Lower' } },
        { name: '102', level: 'Lower', rows: 1, seatsPerRow: 4 },
        { name: '301', level: 'Upper', rows: 1, seatsPerRow: 2 },
      ],
    });
    const eventId = await event(ctx, venueId, { name: 'Seated', capacity: 10 });
    await seatEventOn(
      ctx,
      eventId,
      layout,
      { Courtside: '95.00', Lower: '60.00', Upper: '40.00' },
      [layout.seat('301', 1, 1), layout.seat('301', 1, 2)],
    );
    await sellSeats(ctx, eventId, layout, [
      { section: '101', row: 1, seat: 1, levelName: 'Courtside', price: '95.00' },
      { section: '101', row: 1, seat: 2, levelName: 'Courtside', price: '95.00' },
    ]);
    await sellSeats(ctx, eventId, layout, [
      { section: '101', row: 2, seat: 1, levelName: 'Lower', price: '60.00' },
      // Sold as "Premium" (a carried-over ticket type's name, R16): no current level has it.
      { section: '102', row: 1, seat: 4, levelName: 'Premium', price: '80.00' },
    ]);
    // A refunded order's void ticket counts nowhere.
    const refunded = await sellSeats(ctx, eventId, layout, [
      { section: '102', row: 1, seat: 1, levelName: 'Lower', price: '60.00' },
    ]);
    await ctx.prisma.ticket.updateMany({
      where: { orderId: refunded.orderId },
      data: { status: 'VOID' },
    });
    await ctx.prisma.order.update({
      where: { id: refunded.orderId },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });

    const res = await asAdmin(ctx).get('/reports/sales').expect(200);
    const [line] = res.body.events;
    expect(line).toMatchObject({ ticketsSold: 4, revenue: '330.00', tiers: [] });
    expect(line.levels).toEqual([
      {
        levelId: layout.levels.Courtside,
        name: 'Courtside',
        price: '95.00',
        seatsOnSale: 3,
        ticketsSold: 2,
        revenue: '190.00',
      },
      {
        levelId: layout.levels.Lower,
        name: 'Lower',
        price: '60.00',
        seatsOnSale: 7,
        ticketsSold: 1,
        revenue: '60.00',
      },
      {
        levelId: layout.levels.Upper,
        name: 'Upper',
        price: '40.00',
        seatsOnSale: 0,
        ticketsSold: 0,
        revenue: '0.00',
      },
      {
        levelId: layout.levels.Box,
        name: 'Box',
        price: null,
        seatsOnSale: 0,
        ticketsSold: 0,
        revenue: '0.00',
      },
      {
        levelId: null,
        name: 'Premium',
        price: null,
        seatsOnSale: 0,
        ticketsSold: 1,
        revenue: '80.00',
      },
    ]);
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
