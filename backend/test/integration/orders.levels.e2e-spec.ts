import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import {
  HOLDER,
  customer,
  insertLayout,
  seatedEvent,
  venue,
  type InsertedLayout,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 038 US3 (FR-022, FR-026, research R10): an order for held seats of several levels makes one
 * ticket per seat at its level's price at the moment of purchase, under the event lock;
 * `totalPrice` is their sum and `unitPrice` the one price when all are equal, else `null`. Each
 * ticket keeps its price, level and labels as sold, in the order, My orders and the attendee
 * list. Every response through the request helpers is checked against the contract.
 */
describe('Orders across price levels (038 US3)', () => {
  let ctx: TestContext;
  let venueId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Level Hall');
  });

  const ARENA = [
    { name: 'Floor A', rows: 3, seatsPerRow: 10, level: 'Front' },
    { name: 'Floor B', rows: 3, seatsPerRow: 10, level: 'Back' },
    { name: 'Balcony', rows: 2, seatsPerRow: 5, level: 'Upper' },
  ];
  const PRICED = [
    { name: 'Front', price: '95.00' },
    { name: 'Back', price: '60.00' },
    { name: 'Upper', price: '35.00' },
  ];

  const code = (res: Response): string => res.body.error?.code;
  const seat = (layout: InsertedLayout, name: string, row: number, s: number) => ({
    sectionId: layout.sections[name],
    row,
    seat: s,
  });
  const reserve = async (eventId: string, seats: object[], n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation`).send({ seats }).expect(201);
  const order = async (eventId: string, seats: object[], extra: object = {}, n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: seats.length, seats, ...extra });
  const setPrices = (eventId: string, layout: InsertedLayout, byName: Record<string, string>) =>
    asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({
        levelPrices: Object.entries(byName).map(([name, price]) => ({
          levelId: layout.levels[name],
          price,
        })),
      })
      .expect(200);

  type TicketBody = {
    price: string;
    levelName: string | null;
    seat: { section: string; row: number; seat: number; rowLabel: string; seatLabel: string };
  };
  const bySeat = (tickets: TicketBody[]) =>
    [...tickets]
      .map((t) => ({ price: t.price, levelName: t.levelName, seat: t.seat }))
      .sort((a, b) => a.price.localeCompare(b.price));

  it("sells seats of two levels, each at its level's price at purchase; unitPrice null", async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });
    const seats = [seat(layout, 'Floor A', 2, 7), seat(layout, 'Floor B', 3, 1)];
    await reserve(eventId, seats);
    // A price changed after the hold applies to the purchase.
    await setPrices(eventId, layout, { Front: '99.00', Back: '60.00', Upper: '35.00' });

    const res = await order(eventId, seats);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tierId: null,
      tierName: null,
      quantity: 2,
      unitPrice: null,
      totalPrice: '159.00',
    });
    expect(bySeat(res.body.tickets)).toEqual([
      {
        price: '60.00',
        levelName: 'Back',
        seat: { section: 'Floor B', row: 3, seat: 1, rowLabel: '3', seatLabel: '1' },
      },
      {
        price: '99.00',
        levelName: 'Front',
        seat: { section: 'Floor A', row: 2, seat: 7, rowLabel: '2', seatLabel: '7' },
      },
    ]);
    const stored = await ctx.prisma.ticket.findMany({ where: { eventId } });
    expect(stored.map((t) => t.seatId).sort()).toEqual(
      [layout.seat('Floor A', 2, 7), layout.seat('Floor B', 3, 1)].sort(),
    );
    const placed = await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(placed.tierId).toBeNull();
    expect(placed.unitPrice).toBeNull();
  });

  it('gives unitPrice the one price when every ticket has it', async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });
    const seats = [seat(layout, 'Balcony', 1, 1), seat(layout, 'Balcony', 2, 1)];
    await reserve(eventId, seats);

    const res = await order(eventId, seats);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ unitPrice: '35.00', totalPrice: '70.00' });
    expect(res.body.tickets.map((t: TicketBody) => t.price)).toEqual(['35.00', '35.00']);
  });

  it('keeps the labels as sold, which may differ from the numbers', async () => {
    const layout = await insertLayout(ctx, venueId, {
      name: 'Lettered',
      levels: ['Courtside', 'Lower'],
      sections: [
        { name: '115', level: 'Lower', rows: 8, seatsPerRow: 10, rowLevels: { 6: 'Courtside' } },
      ],
    });
    const { eventId } = await seatedEvent(ctx, venueId, {
      layout,
      levels: [
        { name: 'Courtside', price: '95.00' },
        { name: 'Lower', price: '60.00' },
      ],
    });
    const seats = [seat(layout, '115', 6, 7), seat(layout, '115', 7, 7)];
    await reserve(eventId, seats);

    const res = await order(eventId, seats);

    expect(res.status).toBe(201);
    expect(bySeat(res.body.tickets)).toEqual([
      {
        price: '60.00',
        levelName: 'Lower',
        seat: { section: '115', row: 7, seat: 7, rowLabel: 'G', seatLabel: '7' },
      },
      {
        price: '95.00',
        levelName: 'Courtside',
        seat: { section: '115', row: 6, seat: 7, rowLabel: 'F', seatLabel: '7' },
      },
    ]);
  });

  it('refuses a tierId on a seated order (400), selling nothing', async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });
    const seats = [seat(layout, 'Floor A', 1, 1)];
    await reserve(eventId, seats);

    const res = await order(eventId, seats, { tierId: '00000000-0000-4000-8000-000000000000' });

    expect(res.status).toBe(400);
    expect(await ctx.prisma.ticket.count({ where: { eventId } })).toBe(0);
  });

  it('refuses a seat off sale with 409 SEAT_OFF_SALE', async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
      offSale: [{ section: 'Floor A', row: 1 }],
    });

    const res = await order(eventId, [seat(layout, 'Floor A', 1, 4)]);

    expect(res.status).toBe(409);
    expect(code(res)).toBe('SEAT_OFF_SALE');
    expect(res.body.error.details.seats).toEqual([seat(layout, 'Floor A', 1, 4)]);
  });

  it('shows the same prices, levels and labels in My orders and the attendee list', async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });
    const seats = [seat(layout, 'Floor A', 1, 1), seat(layout, 'Balcony', 1, 2)];
    await reserve(eventId, seats);
    const placed = await order(eventId, seats);
    expect(placed.status).toBe(201);
    // A later price change touches no sold ticket.
    await setPrices(eventId, layout, { Front: '10.00', Back: '10.00', Upper: '10.00' });

    const mine = await (await customer(ctx, 1)).get('/me/orders').expect(200);
    const attendees = await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);

    const expected = bySeat(placed.body.tickets);
    expect(expected.map((t) => t.price)).toEqual(['35.00', '95.00']);
    expect(bySeat(mine.body[0].tickets)).toEqual(expected);
    expect(bySeat(attendees.body[0].tickets)).toEqual(expected);
    expect(mine.body[0]).toMatchObject({ unitPrice: null, totalPrice: '130.00' });
    expect(attendees.body[0]).toMatchObject({ unitPrice: null, totalPrice: '130.00' });
  });
});
