import type { Response } from 'supertest';
import { anon, as, asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, holdSeats, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { AGENT, ADMIN, subFor, tokenFor } from '../setup/tokens';

/**
 * Spec 015 US1 (FR-001–FR-003, FR-007, FR-008, FR-015; research R5, R8): reserving, adding to,
 * releasing, and listing reservations. Every response is checked against the contract by the
 * request helpers (`reserveSeats`, `releaseSeats`, `listMyReservations`,
 * `releaseAllMyReservations`).
 */
describe('Seat reservations', () => {
  let ctx: TestContext;
  let venueId: string;
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
    const layout = await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({
        sections: [
          { name: 'A', rows: 3, seatsPerRow: 10 },
          { name: 'B', rows: 2, seatsPerRow: 20 },
          { name: 'C', rows: 1, seatsPerRow: 5 },
        ],
      })
      .expect(200);
    [sectionA, sectionB, sectionC] = layout.body.sections.map((s: { id: string }) => s.id);
  });

  const code = (res: Response): string => res.body.error?.code;
  const seat = (sectionId: string, row: number, s: number) => ({ sectionId, row, seat: s });
  const reserve = async (eventId: string, seats: object[], n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation`).send({ seats });
  const release = async (eventId: string, seats?: object[], n = 1) => {
    const req = (await customer(ctx, n)).post(`/events/${eventId}/reservation/release`);
    return seats ? req.send({ seats }) : req.send();
  };
  const liveHolds = (eventId: string) =>
    ctx.prisma.seatHold.count({ where: { eventId, releasedAt: null } });

  /** A seated event: VIP in A, General in B, C not for sale. */
  const tiered = async (
    opts: { maxTicketsPerCustomer?: number; startsAt?: string; endsAt?: string } = {},
  ) => {
    const eventId = await event(ctx, venueId, { capacity: 75, ...opts });
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 30);
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

  /** A seated event without tiers: every section is for sale at the base price. */
  const tierless = async () => {
    const eventId = await event(ctx, venueId, { capacity: 75 });
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
    return eventId;
  };

  describe('reserveSeats', () => {
    it('makes a reservation that ends exactly 5 minutes after it was made (201)', async () => {
      const { eventId, vip } = await tiered();

      const res = await reserve(eventId, [seat(sectionA, 1, 6), seat(sectionA, 1, 5)]);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ eventId, tierId: vip });
      expect(res.body.seats).toEqual([
        { sectionId: sectionA, section: 'A', row: 1, seat: 5 },
        { sectionId: sectionA, section: 'A', row: 1, seat: 6 },
      ]);
      const created = Date.parse(res.body.createdAt);
      expect(Date.parse(res.body.expiresAt) - created).toBe(5 * 60_000);
      expect(res.body.secondsLeft).toBeGreaterThanOrEqual(299);
      expect(res.body.secondsLeft).toBeLessThanOrEqual(300);
      expect(await liveHolds(eventId)).toBe(2);
    });

    it('takes its tier from the seats: null for an event without tiers', async () => {
      const eventId = await tierless();

      const res = await reserve(eventId, [seat(sectionC, 1, 1), seat(sectionA, 2, 2)]);

      expect(res.status).toBe(201);
      expect(res.body.tierId).toBeNull();
      expect(res.body.seats).toHaveLength(2);
    });

    it('adds seats to the active reservation with 200, keeping its expiresAt', async () => {
      const { eventId } = await tiered();
      const first = await reserve(eventId, [seat(sectionA, 1, 1)]);
      expect(first.status).toBe(201);

      const added = await reserve(eventId, [seat(sectionA, 1, 2), seat(sectionA, 2, 1)]);

      expect(added.status).toBe(200);
      expect(added.body.expiresAt).toBe(first.body.expiresAt);
      expect(added.body.createdAt).toBe(first.body.createdAt);
      expect(added.body.seats.map((s: { row: number; seat: number }) => [s.row, s.seat])).toEqual([
        [1, 1],
        [1, 2],
        [2, 1],
      ]);
      expect(await ctx.prisma.seatReservation.count({ where: { eventId } })).toBe(1);
    });

    it('refuses bad seats with 400 and reserves nothing (all or nothing)', async () => {
      const { eventId } = await tiered();
      const gaEvent = await event(ctx, venueId, { capacity: 75 });

      const cases: [string, object[]][] = [
        // Outside the layout.
        [eventId, [seat(sectionA, 1, 1), seat(sectionA, 4, 1)]],
        [eventId, [seat(sectionA, 1, 1), seat(sectionA, 1, 11)]],
        // A section not for sale.
        [eventId, [seat(sectionA, 1, 1), seat(sectionC, 1, 1)]],
        // Two tiers.
        [eventId, [seat(sectionA, 1, 1), seat(sectionB, 1, 1)]],
        // Repeated.
        [eventId, [seat(sectionA, 1, 1), seat(sectionA, 1, 1)]],
        // More than 10 in one request.
        [eventId, Array.from({ length: 11 }, (_, i) => seat(sectionB, 1, i + 1))],
        // An event without reserved seating.
        [gaEvent, [seat(sectionA, 1, 1)]],
      ];
      for (const [id, seats] of cases) {
        const res = await reserve(id, seats);
        expect({ seats, status: res.status, code: code(res) }).toEqual({
          seats,
          status: 400,
          code: 'VALIDATION_FAILED',
        });
      }
      expect(await ctx.prisma.seatHold.count()).toBe(0);
      expect(await ctx.prisma.seatReservation.count()).toBe(0);
    });

    it('refuses additions of another tier, already reserved, or past 10 seats in total', async () => {
      const { eventId } = await tiered();
      await reserve(eventId, [seat(sectionA, 1, 1), seat(sectionA, 1, 2)]).then((r) =>
        expect(r.status).toBe(201),
      );

      const cases: object[][] = [
        [seat(sectionB, 1, 1)],
        [seat(sectionA, 3, 3), seat(sectionA, 1, 2)],
        Array.from({ length: 9 }, (_, i) => seat(sectionA, 2, i + 1)),
      ];
      for (const seats of cases) {
        const res = await reserve(eventId, seats);
        expect({ seats, status: res.status, code: code(res) }).toEqual({
          seats,
          status: 400,
          code: 'VALIDATION_FAILED',
        });
      }
      expect(await liveHolds(eventId)).toBe(2);
      // Exactly 10 in total is allowed.
      const ten = await reserve(
        eventId,
        Array.from({ length: 8 }, (_, i) => seat(sectionA, 2, i + 1)),
      );
      expect(ten.status).toBe(200);
      expect(ten.body.seats).toHaveLength(10);
    });

    it('is 404 for an unknown event', async () => {
      const res = await reserve('00000000-0000-4000-8000-000000000000', [seat(sectionA, 1, 1)]);
      expect(res.status).toBe(404);
    });

    it('is 409 EVENT_CANCELLED for a cancelled event', async () => {
      const { eventId } = await tiered();
      await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

      const res = await reserve(eventId, [seat(sectionA, 1, 1)]);

      expect(res.status).toBe(409);
      expect(code(res)).toBe('EVENT_CANCELLED');
    });

    it('is 409 SALES_CLOSED once the event has started', async () => {
      const start = Date.now() - 60_000;
      const { eventId } = await tiered({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 3 * 3_600_000).toISOString(),
      });

      const res = await reserve(eventId, [seat(sectionA, 1, 1)]);

      expect(res.status).toBe(409);
      expect(code(res)).toBe('SALES_CLOSED');
      expect(await ctx.prisma.seatReservation.count()).toBe(0);
    });

    it('is 409 TICKET_LIMIT_REACHED past the limit, counting valid tickets only', async () => {
      const { eventId, vip } = await tiered({ maxTicketsPerCustomer: 3 });
      // One ticket bought.
      await reserve(eventId, [seat(sectionA, 3, 1)]).then((r) => expect(r.status).toBe(201));
      await (
        await customer(ctx)
      )
        .post(`/events/${eventId}/orders`)
        .send({ holderName: HOLDER, tierId: vip, quantity: 1, seats: [seat(sectionA, 3, 1)] })
        .expect(201);

      const over = await reserve(eventId, [
        seat(sectionA, 1, 1),
        seat(sectionA, 1, 2),
        seat(sectionA, 1, 3),
      ]);
      expect(over.status).toBe(409);
      expect(code(over)).toBe('TICKET_LIMIT_REACHED');
      expect(over.body.error.details).toEqual({ limit: 3, held: 1, remaining: 2, requested: 3 });

      // A reservation is not held: 1 then 1 more reach the limit, and held stays 1.
      await reserve(eventId, [seat(sectionA, 1, 1)]).then((r) => expect(r.status).toBe(201));
      await reserve(eventId, [seat(sectionA, 1, 2)]).then((r) => expect(r.status).toBe(200));
      const third = await reserve(eventId, [seat(sectionA, 1, 3)]);
      expect(third.status).toBe(409);
      expect(third.body.error.details).toEqual({ limit: 3, held: 1, remaining: 2, requested: 3 });
    });

    it('is 403 for an admin and a gate agent, and 401 without a token', async () => {
      const { eventId } = await tiered();
      for (const who of [ADMIN, AGENT]) {
        const res = await as(ctx, await tokenFor(who))
          .post(`/events/${eventId}/reservation`)
          .send({ seats: [seat(sectionA, 1, 1)] });
        expect(res.status).toBe(403);
      }
      await anon(ctx)
        .post(`/events/${eventId}/reservation`)
        .send({ seats: [seat(sectionA, 1, 1)] })
        .expect(401);
      expect(await ctx.prisma.seatHold.count()).toBe(0);
    });
  });

  describe('releaseSeats', () => {
    it('releases one seat and keeps the rest, with the same expiresAt', async () => {
      const { eventId } = await tiered();
      const made = await reserve(eventId, [seat(sectionA, 1, 1), seat(sectionA, 1, 2)]);

      const res = await release(eventId, [seat(sectionA, 1, 1)]);

      expect(res.status).toBe(200);
      expect(res.body.reservation.expiresAt).toBe(made.body.expiresAt);
      expect(res.body.reservation.seats).toEqual([
        { sectionId: sectionA, section: 'A', row: 1, seat: 2 },
      ]);
      const ended = await ctx.prisma.seatHold.findFirstOrThrow({
        where: { eventId, seatRow: 1, seatNumber: 1 },
      });
      expect(ended).toMatchObject({ endReason: 'RELEASED', releasedAt: expect.any(Date) });
    });

    it('releases every seat without a body, and ends the reservation', async () => {
      const { eventId } = await tiered();
      await reserve(eventId, [seat(sectionA, 1, 1), seat(sectionA, 1, 2)]);

      const res = await release(eventId);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reservation: null });
      expect(await liveHolds(eventId)).toBe(0);
      const r = await ctx.prisma.seatReservation.findFirstOrThrow({ where: { eventId } });
      expect(r.endedAt).not.toBeNull();
    });

    it('ends the reservation when its last seat is released by name', async () => {
      const { eventId } = await tiered();
      await reserve(eventId, [seat(sectionA, 1, 1)]);

      const res = await release(eventId, [seat(sectionA, 1, 1)]);

      expect(res.body).toEqual({ reservation: null });
      const r = await ctx.prisma.seatReservation.findFirstOrThrow({ where: { eventId } });
      expect(r.endedAt).not.toBeNull();
    });

    it('is 400 for a seat not in the reservation, and releases nothing', async () => {
      const { eventId } = await tiered();
      await reserve(eventId, [seat(sectionA, 1, 1)]);

      const res = await release(eventId, [seat(sectionA, 1, 1), seat(sectionA, 1, 2)]);

      expect(res.status).toBe(400);
      expect(await liveHolds(eventId)).toBe(1);
    });

    it("is 200 with null when there is no active reservation, and doesn't touch another's", async () => {
      const { eventId } = await tiered();
      await reserve(eventId, [seat(sectionA, 1, 1)], 2);

      const res = await release(eventId);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reservation: null });
      expect(await liveHolds(eventId)).toBe(1);
    });

    it('is 404 for an unknown event', async () => {
      const res = await release('00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(404);
    });

    it('is 403 for an admin and a gate agent, and 401 without a token', async () => {
      const { eventId } = await tiered();
      for (const who of [ADMIN, AGENT]) {
        const res = await as(ctx, await tokenFor(who))
          .post(`/events/${eventId}/reservation/release`)
          .send();
        expect(res.status).toBe(403);
      }
      await anon(ctx).post(`/events/${eventId}/reservation/release`).send().expect(401);
    });
  });

  describe('listMyReservations', () => {
    it("returns only the caller's active reservations, for every event, newest first", async () => {
      const first = await tiered();
      const second = await tiered();
      const third = await tierless();
      await reserve(first.eventId, [seat(sectionA, 1, 1)]);
      await reserve(second.eventId, [seat(sectionB, 2, 2), seat(sectionB, 2, 1)]);
      // Another customer's, an ended one, and a run-out one are not listed.
      await reserve(first.eventId, [seat(sectionA, 1, 2)], 2);
      await reserve(third, [seat(sectionC, 1, 1)]);
      await release(third);
      const runOut = await tierless();
      await holdSeats(ctx.prisma, {
        eventId: runOut,
        customerSub: subFor('customer1'),
        seats: [{ section: 'A', row: 1, seat: 1 }],
        secondsAgo: 5 * 60,
      });

      const res = await (await customer(ctx)).get('/me/reservations').expect(200);

      expect(res.body.map((r: { eventId: string }) => r.eventId)).toEqual([
        second.eventId,
        first.eventId,
      ]);
      expect(res.body[0].seats).toEqual([
        { sectionId: sectionB, section: 'B', row: 2, seat: 1 },
        { sectionId: sectionB, section: 'B', row: 2, seat: 2 },
      ]);
      expect(res.body[0].secondsLeft).toBeGreaterThan(290);
    });

    it('is empty with nothing reserved, 403 for an admin, and 401 without a token', async () => {
      expect((await (await customer(ctx)).get('/me/reservations').expect(200)).body).toEqual([]);
      await asAdmin(ctx).get('/me/reservations').expect(403);
      await anon(ctx).get('/me/reservations').expect(401);
    });
  });

  describe('releaseAllMyReservations', () => {
    it('ends every active reservation of the caller with LOGOUT, and is 0 when repeated', async () => {
      const first = await tiered();
      const second = await tierless();
      await reserve(first.eventId, [seat(sectionA, 1, 1), seat(sectionA, 1, 2)]);
      await reserve(second, [seat(sectionC, 1, 1)]);
      await reserve(first.eventId, [seat(sectionA, 3, 3)], 2);

      const me = await customer(ctx);
      const res = await me.post('/me/reservations/release').expect(200);

      expect(res.body).toEqual({ released: 3 });
      const mine = await ctx.prisma.seatHold.findMany({
        where: { reservation: { customerSub: subFor('customer1') } },
      });
      expect(mine.map((h) => h.endReason)).toEqual(['LOGOUT', 'LOGOUT', 'LOGOUT']);
      expect(
        await ctx.prisma.seatReservation.count({
          where: { customerSub: subFor('customer1'), endedAt: null },
        }),
      ).toBe(0);
      // Another customer's reservation is untouched.
      expect(await liveHolds(first.eventId)).toBe(1);

      expect((await me.post('/me/reservations/release').expect(200)).body).toEqual({
        released: 0,
      });
    });

    it('is 403 for an admin and a gate agent, and 401 without a token', async () => {
      for (const who of [ADMIN, AGENT]) {
        await as(ctx, await tokenFor(who))
          .post('/me/reservations/release')
          .expect(403);
      }
      await anon(ctx).post('/me/reservations/release').expect(401);
    });
  });
});
