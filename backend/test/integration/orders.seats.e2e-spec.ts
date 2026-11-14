import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import {
  HOLDER,
  customer,
  event,
  reserveThenOrder,
  seatedEvent,
  seatedLayout,
  venue,
  type InsertedLayout,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 007 US2 (FR-005–FR-008, FR-011; research R6): ordering seats. Spec 038 (research R10): on a
 * layout with price levels, each seat at its level's price; no ticket types.
 */
describe('Orders with seats', () => {
  let ctx: TestContext;
  let venueId: string;
  let layout: InsertedLayout;
  let sectionA: string;
  let sectionB: string;
  let sectionC: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Seat Hall');
    layout = await seatedLayout(
      ctx,
      venueId,
      [
        { name: 'A', rows: 3, seatsPerRow: 10, level: 'VIP' },
        { name: 'B', rows: 2, seatsPerRow: 20, level: 'General' },
        { name: 'C', rows: 1, seatsPerRow: 5, level: 'Upper' },
      ],
      ['VIP', 'General', 'Upper'],
    );
    ({ A: sectionA, B: sectionB, C: sectionC } = layout.sections);
  });

  const order = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, ...body });
  /** Spec 015 FR-006: a seated order buys seats the customer has reserved first. */
  const bought = async (
    eventId: string,
    body: {
      seats: { sectionId: string; row: number; seat: number }[];
      requestId?: string;
    },
    n = 1,
  ) =>
    reserveThenOrder(
      ctx,
      await tokenFor({ username: `customer${n}`, roles: ['customer'] }),
      eventId,
      body,
    );
  const code = (res: Response): string => res.body.error?.code;
  const seat = (sectionId: string, row: number, s: number) => ({ sectionId, row, seat: s });

  /** A seated event: VIP ($120) on A, General ($40) on B, C (Upper) off sale. */
  const tiered = async () =>
    (
      await seatedEvent(ctx, venueId, {
        layout,
        levels: [
          { name: 'VIP', price: '120.00' },
          { name: 'General', price: '40.00' },
          { name: 'Upper', price: null },
        ],
        offSale: [{ section: 'C' }],
      })
    ).eventId;

  it('issues one ticket per seat, each labelled with its section, row, and seat', async () => {
    const eventId = await tiered();

    const res = await bought(eventId, {
      seats: [seat(sectionA, 1, 6), seat(sectionA, 1, 5)],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tierName: null,
      quantity: 2,
      unitPrice: '120.00',
      totalPrice: '240.00',
    });
    const tickets = res.body.tickets.map((t: object) => ({
      seat: (t as { seat: object }).seat,
      levelName: (t as { levelName: string }).levelName,
      price: (t as { price: string }).price,
    }));
    expect(tickets).toHaveLength(2);
    expect(tickets).toEqual(
      expect.arrayContaining([
        {
          seat: { section: 'A', row: 1, seat: 5, rowLabel: '1', seatLabel: '5' },
          levelName: 'VIP',
          price: '120.00',
        },
        {
          seat: { section: 'A', row: 1, seat: 6, rowLabel: '1', seatLabel: '6' },
          levelName: 'VIP',
          price: '120.00',
        },
      ]),
    );
  });

  it('refuses malformed seat choices with 400 and records nothing', async () => {
    const eventId = await tiered();
    const gaEvent = await event(ctx, venueId, { capacity: 70 });
    const elsewhere = await venue(ctx, 'Other Hall');
    const other = await seatedLayout(ctx, elsewhere, [{ name: 'Z', rows: 1, seatsPerRow: 5 }]);

    const cases: [string, object][] = [
      [eventId, { quantity: 1 }],
      [eventId, { quantity: 2, seats: [seat(sectionA, 1, 1)] }],
      [gaEvent, { quantity: 1, seats: [seat(sectionA, 1, 1)] }],
      [eventId, { quantity: 2, seats: [seat(sectionA, 1, 1), seat(sectionA, 1, 1)] }],
      [eventId, { quantity: 1, seats: [seat(sectionA, 4, 1)] }],
      [eventId, { quantity: 1, seats: [seat(sectionA, 1, 11)] }],
      [eventId, { quantity: 1, seats: [seat(other.sections.Z, 1, 1)] }],
      // Spec 038 (research R10): a seated event has no ticket types.
      [eventId, { tierId: randomUUID(), quantity: 1, seats: [seat(sectionB, 1, 1)] }],
      [eventId, { quantity: 1, seats: [{ sectionId: sectionA, row: 0, seat: 1 }] }],
    ];
    for (const [id, body] of cases) {
      const res = await order(id, body);
      expect({ body, status: res.status, code: code(res) }).toEqual({
        body,
        status: 400,
        code: 'VALIDATION_FAILED',
      });
    }
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  // Spec 038: `007`'s "section mapped to no tier" is now a seat off sale (409 SEAT_OFF_SALE).
  it('refuses a seat off sale', async () => {
    const eventId = await tiered();

    const res = await order(eventId, { quantity: 1, seats: [seat(sectionC, 1, 1)] });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('SEAT_OFF_SALE');
    expect(res.body.error.details.seats).toEqual([seat(sectionC, 1, 1)]);
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('sells any section at one price when every section has the same level', async () => {
    const { eventId, layout: one } = await seatedEvent(ctx, venueId, {
      sections: [
        { name: 'A', rows: 3, seatsPerRow: 10 },
        { name: 'B', rows: 2, seatsPerRow: 20 },
      ],
      levels: [{ name: 'Standard', price: '25.00' }],
    });

    const res = await bought(eventId, {
      seats: [seat(one.sections.A, 2, 3), seat(one.sections.B, 1, 20)],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ unitPrice: '25.00', totalPrice: '50.00' });
  });

  it('refuses taken seats, naming them, and records nothing', async () => {
    const eventId = await tiered();
    await bought(eventId, { seats: [seat(sectionA, 1, 5)] }, 1).then((r) =>
      expect(r.status).toBe(201),
    );

    const res = await order(
      eventId,
      { quantity: 2, seats: [seat(sectionA, 1, 4), seat(sectionA, 1, 5)] },
      2,
    );

    expect(res.status).toBe(409);
    expect(code(res)).toBe('SEAT_TAKEN');
    expect(res.body.error.details.seats).toEqual([{ section: 'A', row: 1, seat: 5 }]);
    expect(await ctx.prisma.order.count()).toBe(1);
  });

  // Spec 038 (FR-012, FR-014, research R9): `007`'s seated tier amounts are gone; a seated
  // event has no ticket types, and its capacity is its seats on sale.
  it('gives a seated event no ticket types and its seats on sale as its capacity', async () => {
    const eventId = await tiered();
    const tiers = await asAdmin(ctx).get(`/events/${eventId}/tiers`).expect(200);
    expect(tiers.body).toEqual([]);
    const got = await asAdmin(ctx).get(`/events/${eventId}`).expect(200);
    expect(got.body).toMatchObject({ totalTicketCapacity: 70, basePrice: '40.00' });
  });

  it('treats a repeated requestId with the same seats as a repeat, and different seats as reuse', async () => {
    const eventId = await tiered();
    const requestId = randomUUID();
    const body = { quantity: 1, seats: [seat(sectionA, 2, 2)], requestId };
    const first = await bought(eventId, body);
    expect(first.status).toBe(201);

    const repeat = await order(eventId, body);
    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(first.body.id);

    const changed = await order(eventId, { ...body, seats: [seat(sectionA, 2, 3)] });
    expect(changed.status).toBe(409);
    expect(code(changed)).toBe('REQUEST_ID_REUSED');
  });

  it('shows seats on My orders and the attendee list, and none for general admission', async () => {
    const eventId = await tiered();
    await bought(eventId, { seats: [seat(sectionA, 3, 10)] });
    const gaEvent = await event(ctx, venueId, { capacity: 70 });
    const ga = await order(gaEvent, { quantity: 1 });
    expect(ga.body.tickets[0].seat).toBeNull();

    const mine = await (await customer(ctx)).get('/me/orders').expect(200);
    const seated = mine.body.find((o: { eventId: string }) => o.eventId === eventId);
    const sold = { section: 'A', row: 3, seat: 10, rowLabel: '3', seatLabel: '10' };
    expect(seated.tickets[0].seat).toEqual(sold);

    const attendees = await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);
    expect(attendees.body[0].tickets[0].seat).toEqual(sold);
  });
});
