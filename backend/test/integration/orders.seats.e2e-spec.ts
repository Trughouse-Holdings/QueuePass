import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { customer, event, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 007 US2 (FR-005–FR-008, FR-011; research R6): ordering seats. */
describe('Orders with seats', () => {
  let ctx: TestContext;
  let venueId: string;
  let sectionA: string;
  let sectionB: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Seat Hall');
    const layout = await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({
        sections: [
          { name: 'A', rows: 3, seatsPerRow: 10 },
          { name: 'B', rows: 2, seatsPerRow: 20 },
        ],
      })
      .expect(200);
    [sectionA, sectionB] = layout.body.sections.map((s: { id: string }) => s.id);
  });

  const order = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/orders`).send(body);
  const code = (res: Response): string => res.body.error?.code;
  const seat = (sectionId: string, row: number, s: number) => ({ sectionId, row, seat: s });

  /** A seated event with VIP mapped to A and General to B (C left unmapped where added). */
  const tiered = async (vipQuantity = 30) => {
    const eventId = await event(ctx, venueId, { capacity: 70 });
    const vip = await tier(ctx, eventId, 'VIP', '120.00', vipQuantity);
    const general = await tier(ctx, eventId, 'General', '40.00', 40);
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({
        reservedSeating: true,
        sections: [
          { sectionId: sectionA, tierId: vip },
          { sectionId: sectionB, tierId: general },
        ],
      })
      .expect(200);
    return { eventId, vip, general };
  };

  it('issues one ticket per seat, each labelled with its section, row, and seat', async () => {
    const { eventId, vip } = await tiered();

    const res = await order(eventId, {
      tierId: vip,
      quantity: 2,
      seats: [seat(sectionA, 1, 6), seat(sectionA, 1, 5)],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tierName: 'VIP', quantity: 2, totalPrice: '240.00' });
    const seats = res.body.tickets.map((t: { seat: object }) => t.seat);
    expect(seats).toHaveLength(2);
    expect(seats).toEqual(
      expect.arrayContaining([
        { section: 'A', row: 1, seat: 5 },
        { section: 'A', row: 1, seat: 6 },
      ]),
    );
  });

  it('refuses malformed seat choices with 400 and records nothing', async () => {
    const { eventId, vip } = await tiered();
    const gaEvent = await event(ctx, venueId);
    const elsewhere = await venue(ctx, 'Other Hall');
    const other = await asAdmin(ctx)
      .put(`/locations/${elsewhere}/layout`)
      .send({ sections: [{ name: 'Z', rows: 1, seatsPerRow: 5 }] })
      .expect(200);

    const cases: [string, object][] = [
      [eventId, { tierId: vip, quantity: 1 }],
      [eventId, { tierId: vip, quantity: 2, seats: [seat(sectionA, 1, 1)] }],
      [gaEvent, { quantity: 1, seats: [seat(sectionA, 1, 1)] }],
      [eventId, { tierId: vip, quantity: 2, seats: [seat(sectionA, 1, 1), seat(sectionA, 1, 1)] }],
      [eventId, { tierId: vip, quantity: 1, seats: [seat(sectionA, 4, 1)] }],
      [eventId, { tierId: vip, quantity: 1, seats: [seat(sectionA, 1, 11)] }],
      [eventId, { tierId: vip, quantity: 1, seats: [seat(other.body.sections[0].id, 1, 1)] }],
      [eventId, { tierId: vip, quantity: 1, seats: [seat(sectionB, 1, 1)] }],
      [eventId, { tierId: vip, quantity: 1, seats: [{ sectionId: sectionA, row: 0, seat: 1 }] }],
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

  it('refuses a seat in a section mapped to no tier', async () => {
    const eventId = await event(ctx, venueId, { capacity: 70 });
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 30);
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [{ sectionId: sectionA, tierId: vip }] })
      .expect(200);

    const res = await order(eventId, { tierId: vip, quantity: 1, seats: [seat(sectionB, 1, 1)] });
    expect(res.status).toBe(400);
  });

  it('sells any section at the base price for a seated event without tiers', async () => {
    const eventId = await event(ctx, venueId, { capacity: 70, basePrice: '25.00' });
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);

    const res = await order(eventId, {
      quantity: 2,
      seats: [seat(sectionA, 2, 3), seat(sectionB, 1, 20)],
    });

    expect(res.status).toBe(201);
    expect(res.body.totalPrice).toBe('50.00');
  });

  it('refuses taken seats, naming them, and records nothing', async () => {
    const { eventId, vip } = await tiered();
    await order(eventId, { tierId: vip, quantity: 1, seats: [seat(sectionA, 1, 5)] }, 1).then((r) =>
      expect(r.status).toBe(201),
    );

    const res = await order(
      eventId,
      { tierId: vip, quantity: 2, seats: [seat(sectionA, 1, 4), seat(sectionA, 1, 5)] },
      2,
    );

    expect(res.status).toBe(409);
    expect(code(res)).toBe('SEAT_TAKEN');
    expect(res.body.error.details.seats).toEqual([{ section: 'A', row: 1, seat: 5 }]);
    expect(await ctx.prisma.order.count()).toBe(1);
  });

  it("still stops at the tier's quantity with seats open", async () => {
    const { eventId, vip } = await tiered(1);
    await order(eventId, { tierId: vip, quantity: 1, seats: [seat(sectionA, 1, 1)] }).then((r) =>
      expect(r.status).toBe(201),
    );

    const res = await order(eventId, { tierId: vip, quantity: 1, seats: [seat(sectionA, 1, 2)] });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('SOLD_OUT');
  });

  it('treats a repeated requestId with the same seats as a repeat, and different seats as reuse', async () => {
    const { eventId, vip } = await tiered();
    const requestId = randomUUID();
    const body = { tierId: vip, quantity: 1, seats: [seat(sectionA, 2, 2)], requestId };
    const first = await order(eventId, body);
    expect(first.status).toBe(201);

    const repeat = await order(eventId, body);
    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(first.body.id);

    const changed = await order(eventId, { ...body, seats: [seat(sectionA, 2, 3)] });
    expect(changed.status).toBe(409);
    expect(code(changed)).toBe('REQUEST_ID_REUSED');
  });

  it('shows seats on My orders and the attendee list, and none for general admission', async () => {
    const { eventId, vip } = await tiered();
    await order(eventId, { tierId: vip, quantity: 1, seats: [seat(sectionA, 3, 10)] });
    const gaEvent = await event(ctx, venueId);
    const ga = await order(gaEvent, { quantity: 1 });
    expect(ga.body.tickets[0].seat).toBeNull();

    const mine = await (await customer(ctx)).get('/me/orders').expect(200);
    const seated = mine.body.find((o: { eventId: string }) => o.eventId === eventId);
    expect(seated.tickets[0].seat).toEqual({ section: 'A', row: 3, seat: 10 });

    const attendees = await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);
    expect(attendees.body[0].tickets[0].seat).toEqual({ section: 'A', row: 3, seat: 10 });
  });
});
