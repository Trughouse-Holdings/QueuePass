import { asAdmin } from '../setup/authed-request';
import { event, insertLayout, seatEventOn, venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 038 FR-024, research R9 (T009a): every event response carries `priceMax`, `null` for general
 * admission and, for a seated event, the highest price of a level with seats on sale (a seat's level
 * is its own, else its row's, else its section's, R1), so a list shows "$20–$95" without another
 * read. Responses are checked against contract 2.0.0 by the request helpers.
 */
describe('Event.priceMax (038)', () => {
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

  it('is null for a general-admission event, in getEvent, the list and the create response', async () => {
    const venueId = await venue(ctx);
    const created = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Walk-in',
        locationId: venueId,
        ...windowAt(380),
        totalTicketCapacity: 100,
        basePrice: '20.00',
      })
      .expect(201);
    expect(created.body).toMatchObject({ layoutId: null, priceMax: null });
    const one = await asAdmin(ctx).get(`/events/${created.body.id}`).expect(200);
    expect(one.body.priceMax).toBeNull();
    const list = await asAdmin(ctx).get('/events').expect(200);
    expect(list.body.map((e: { priceMax: unknown }) => e.priceMax)).toEqual([null]);
    expect(Object.keys(one.body)).not.toContain('seatSeq');
  });

  it("is a seated event's highest price among levels with seats on sale", async () => {
    const venueId = await venue(ctx, 'Seated Hall');
    // Floor (95.00): section 101's row A and seat B-2 only. Lower (60.00): the rest of 101 and
    // all of 102. Upper (40.00): all of 103. Box (150.00): no seat, so never on sale.
    const layout = await insertLayout(ctx, venueId, {
      levels: ['Floor', 'Lower', 'Upper', 'Box'],
      sections: [
        {
          name: '101',
          level: 'Lower',
          rows: 2,
          seatsPerRow: 3,
          rowLevels: { 1: 'Floor' },
          seatLevels: { '2/2': 'Floor' },
        },
        { name: '102', level: 'Lower', rows: 1, seatsPerRow: 3 },
        { name: '103', level: 'Upper', rows: 1, seatsPerRow: 2 },
      ],
    });
    const eventId = await event(ctx, venueId, { capacity: 14 });
    const prices = { Floor: '95.00', Lower: '60.00', Upper: '40.00', Box: '150.00' };
    await seatEventOn(ctx, eventId, layout, prices);

    const priceMax = async () =>
      (await asAdmin(ctx).get(`/events/${eventId}`).expect(200)).body.priceMax;
    expect(await priceMax()).toBe('95.00');
    const list = await asAdmin(ctx).get('/events').expect(200);
    expect(list.body[0]).toMatchObject({ layoutId: layout.id, priceMax: '95.00' });

    // Row A off sale: B-2 (its own level Floor) still sells, so Floor stays.
    await seatEventOn(ctx, eventId, layout, prices, [
      layout.seat('101', 1, 1),
      layout.seat('101', 1, 2),
      layout.seat('101', 1, 3),
    ]);
    expect(await priceMax()).toBe('95.00');

    // B-2 off sale too: no Floor seat on sale, so Lower is the highest.
    await seatEventOn(ctx, eventId, layout, prices, [
      layout.seat('101', 1, 1),
      layout.seat('101', 1, 2),
      layout.seat('101', 1, 3),
      layout.seat('101', 2, 2),
    ]);
    expect(await priceMax()).toBe('60.00');
  });
});
