import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { customer, event, reserveThenOrder, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 015 FR-006, FR-017 (research R7): a seated order must name only seats in the caller's own
 * active reservation. Bought holds end in the transaction that issues the tickets.
 */
describe('Seated orders need a reservation', () => {
  let ctx: TestContext;
  let venueId: string;
  let sectionA: string;
  let eventId: string;
  let vip: string;

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
      .send({ sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }] })
      .expect(200);
    sectionA = layout.body.sections[0].id;
    eventId = await event(ctx, venueId, { capacity: 30 });
    vip = await tier(ctx, eventId, 'VIP', '120.00', 30);
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [{ sectionId: sectionA, tierId: vip }] })
      .expect(200);
  });

  const code = (res: Response): string => res.body.error?.code;
  const seat = (row: number, s: number) => ({ sectionId: sectionA, row, seat: s });
  const token = (n = 1) => tokenFor({ username: `customer${n}`, roles: ['customer'] });
  const reserve = async (seats: object[], n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation`).send({ seats });
  const order = async (seats: object[], n = 1, requestId?: string) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ tierId: vip, quantity: seats.length, seats, ...(requestId ? { requestId } : {}) });

  it('refuses a seated order without a reservation, and records nothing', async () => {
    const res = await order([seat(1, 5)]);

    expect(res.status).toBe(409);
    expect(code(res)).toBe('RESERVATION_REQUIRED');
    expect(res.body.error.details).toEqual({
      seats: [{ section: 'A', row: 1, seat: 5 }],
      expired: false,
    });
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('accepts the reserved seats, ends their holds BOUGHT, and ends the reservation', async () => {
    const res = await reserveThenOrder(ctx, await token(), eventId, {
      tierId: vip,
      seats: [seat(1, 5), seat(1, 6)],
    });

    expect(res.status).toBe(201);
    const holds = await ctx.prisma.seatHold.findMany({ where: { eventId } });
    expect(holds.map((h) => h.endReason)).toEqual(['BOUGHT', 'BOUGHT']);
    const r = await ctx.prisma.seatReservation.findFirstOrThrow({ where: { eventId } });
    expect(r.endedAt).not.toBeNull();
    const map = await asAdmin(ctx).get(`/events/${eventId}/seats`).expect(200);
    expect(map.body.sections[0]).toMatchObject({ sold: 2, reserved: [] });
  });

  it('leaves the seats not bought reserved, with the same expiresAt', async () => {
    const made = await reserve([seat(1, 5), seat(1, 6), seat(1, 7)]);

    expect((await order([seat(1, 6)])).status).toBe(201);

    const mine = await (await customer(ctx)).get('/me/reservations').expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].expiresAt).toBe(made.body.expiresAt);
    expect(mine.body[0].seats.map((s: { seat: number }) => s.seat)).toEqual([5, 7]);
  });

  it("refuses a seat in another customer's reservation as taken, saying reserved", async () => {
    await reserve([seat(1, 5)], 2);
    await reserve([seat(1, 6)]);

    const res = await order([seat(1, 5), seat(1, 6)]);

    expect(res.status).toBe(409);
    expect(code(res)).toBe('SEAT_TAKEN');
    expect(res.body.error.details).toEqual({
      seats: [{ section: 'A', row: 1, seat: 5 }],
      reserved: [{ section: 'A', row: 1, seat: 5 }],
    });
    expect(res.body.error.message).toBe(
      'Section A, Row 1, Seat 5 is reserved by another customer.',
    );
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('refuses seats outside the reservation, naming them, when the rest are reserved', async () => {
    await reserve([seat(1, 5)]);

    const res = await order([seat(1, 5), seat(2, 2)]);

    expect(res.status).toBe(409);
    expect(code(res)).toBe('RESERVATION_REQUIRED');
    expect(res.body.error.details).toEqual({
      seats: [{ section: 'A', row: 2, seat: 2 }],
      expired: false,
    });
  });

  it('returns the earlier order for a requestId repeated after the reservation ended', async () => {
    const requestId = randomUUID();
    const first = await reserveThenOrder(ctx, await token(), eventId, {
      tierId: vip,
      seats: [seat(1, 5)],
      requestId,
    });
    expect(first.status).toBe(201);

    const again = await order([seat(1, 5)], 1, requestId);

    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it('leaves general-admission orders unchanged', async () => {
    const ga = await event(ctx, venueId, { capacity: 30 });

    const res = await (await customer(ctx)).post(`/events/${ga}/orders`).send({ quantity: 2 });

    expect(res.status).toBe(201);
    expect(await ctx.prisma.seatReservation.count()).toBe(0);
  });
});
