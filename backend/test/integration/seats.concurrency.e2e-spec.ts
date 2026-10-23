import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, reserveThenOrder, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 007 US3 (FR-009, FR-010, SC-001; research R2): no seat is ever sold twice. Spec 015: a
 * seated order needs the customer's reservation, so the races here are one customer's own
 * simultaneous orders; the many-customer race is for the reservation itself
 * (reservations.concurrency.e2e-spec.ts).
 */
describe('One valid ticket per seat', () => {
  let ctx: TestContext;
  let eventId: string;
  let sectionA: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const venueId = await venue(ctx, 'Seat Hall');
    const layout = await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({ sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }] })
      .expect(200);
    sectionA = layout.body.sections[0].id;
    eventId = await event(ctx, venueId, { capacity: 30 });
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
  });

  const seat = (row: number, s: number) => ({ sectionId: sectionA, row, seat: s });
  const order = async (n: number, seats: object[]) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: seats.length, seats, requestId: randomUUID() });
  const reserve = async (n: number, seats: object[]) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation`).send({ seats }).expect(201);
  const bought = async (n: number, seats: { sectionId: string; row: number; seat: number }[]) =>
    reserveThenOrder(
      ctx,
      await tokenFor({ username: `customer${n}`, roles: ['customer'] }),
      eventId,
      {
        seats,
      },
    );
  const code = (res: Response): string => res.body.error?.code;

  it('lets exactly 1 of 10 simultaneous orders for the same reserved seat succeed', async () => {
    await reserve(1, [seat(1, 1)]);

    const results = await Promise.all(Array.from({ length: 10 }, () => order(1, [seat(1, 1)])));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused).toHaveLength(9);
    for (const r of refused) {
      expect(r.status).toBe(409);
      expect(code(r)).toBe('SEAT_TAKEN');
    }
    expect(
      await ctx.prisma.ticket.count({
        where: { eventId, status: 'VALID', seatSection: 'A', seatRow: 1, seatNumber: 1 },
      }),
    ).toBe(1);
  });

  it('lets exactly one of two simultaneous overlapping orders succeed', async () => {
    await reserve(1, [seat(2, 1), seat(2, 2), seat(2, 3)]);

    const [first, second] = await Promise.all([
      order(1, [seat(2, 1), seat(2, 2)]),
      order(1, [seat(2, 2), seat(2, 3)]),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await ctx.prisma.ticket.count({ where: { eventId, status: 'VALID' } })).toBe(2);
  });

  it('frees every seat when the event is cancelled', async () => {
    await bought(1, [seat(1, 1), seat(1, 2)]).then((r) => expect(r.status).toBe(201));

    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const map = await asAdmin(ctx).get(`/events/${eventId}/seats`).expect(200);
    expect(map.body.sections[0]).toMatchObject({ sold: 0, taken: [] });
  });

  it('holds below the Backend: the database refuses a second valid ticket for a seat', async () => {
    const placed = await bought(1, [seat(3, 3)]);
    expect(placed.status).toBe(201);
    const orderId = placed.body.id;
    const tierless = { orderId, eventId, tierId: null };

    await expect(
      ctx.prisma.ticket.create({
        data: { ...tierless, code: 'ZZZZ2222ZZZZ', seatSection: 'A', seatRow: 3, seatNumber: 3 },
      }),
    ).rejects.toThrow(/ticket_one_valid_per_seat|Unique constraint/);

    // A void ticket does not hold its seat, so a new valid one may take it.
    await ctx.prisma.ticket.updateMany({ where: { orderId }, data: { status: 'VOID' } });
    await expect(
      ctx.prisma.ticket.create({
        data: { ...tierless, code: 'YYYY3333YYYY', seatSection: 'A', seatRow: 3, seatNumber: 3 },
      }),
    ).resolves.toMatchObject({ seatRow: 3, seatNumber: 3 });
  });
});
