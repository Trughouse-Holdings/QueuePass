import type { Response } from 'supertest';
import { HoldSweeper } from '../../src/reservations/hold-sweeper';
import { asAdmin } from '../setup/authed-request';
import { HOLDER, customer, endHold, event, holdSeats, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor } from '../setup/tokens';

/**
 * Spec 015 FR-004, FR-004a, FR-019 (research R3, R4, R6): the 5-minute end and the 2-minute wait,
 * one second before and at each boundary. Spec 033 FR-006 (research R4): the wait counts from the
 * reservation's end and covers every seat that left it released, run out, or by logout. Rows are
 * moved into the past by the database's clock instead of waiting, so the database decides every
 * boundary.
 */
describe('Reservation time boundaries', () => {
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

  const code = (res: Response): string => res.body.error?.code;
  const seat = (row: number, s: number) => ({ sectionId: sectionA, row, seat: s });
  const reserve = async (seats: object[], n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation`).send({ seats });
  const order = async (seats: object[], n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: seats.length, seats });
  const held = (secondsAgo: number, n = 1, seats = [{ section: 'A', row: 1, seat: 5 }]) =>
    holdSeats(ctx.prisma, { eventId, customerSub: subFor(`customer${n}`), seats, secondsAgo });

  /** Ends a reservation and its holds `secondsAgo` before the database's now, with a reason. */
  async function ended(reservationId: string, reason: string, secondsAgo: number): Promise<Date> {
    await ctx.prisma.$executeRaw`
      UPDATE "SeatHold" SET "releasedAt" = now() - make_interval(secs => ${secondsAgo}),
                            "endReason" = ${reason}::"SeatHoldEnd"
      WHERE "reservationId" = ${reservationId}::uuid`;
    await ctx.prisma.$executeRaw`
      UPDATE "SeatReservation" SET "endedAt" = now() - make_interval(secs => ${secondsAgo})
      WHERE "id" = ${reservationId}::uuid`;
    const hold = await ctx.prisma.seatHold.findFirstOrThrow({ where: { reservationId } });
    return hold.releasedAt as Date;
  }

  describe('the 5 minutes (FR-004)', () => {
    it('is active one second before expiresAt: listed and orderable', async () => {
      await held(299);

      const mine = await (await customer(ctx)).get('/me/reservations').expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].secondsLeft).toBeLessThanOrEqual(1);

      expect((await order([seat(1, 5)])).status).toBe(201);
    });

    it('is over at expiresAt: the order is refused as expired and the seat is free', async () => {
      const { reservationId } = await held(300);

      const refused = await order([seat(1, 5)]);
      expect(refused.status).toBe(409);
      expect(code(refused)).toBe('RESERVATION_REQUIRED');
      expect(refused.body.error.details).toEqual({
        seats: [{ section: 'A', row: 1, seat: 5 }],
        expired: true,
      });
      expect((await (await customer(ctx)).get('/me/reservations')).body).toEqual([]);

      // Another customer may reserve it at once.
      expect((await reserve([seat(1, 5)], 2)).status).toBe(201);

      // That locked path closed it first, at exactly expiresAt. (The refused order rolled back.)
      const r = await ctx.prisma.seatReservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { holds: true },
      });
      expect(r.endedAt).toEqual(r.expiresAt);
      expect(r.holds[0]).toMatchObject({ releasedAt: r.expiresAt, endReason: 'EXPIRED' });
    });

    it('lets another customer reserve the seat of a run-out reservation not closed yet', async () => {
      await held(301);

      expect((await reserve([seat(1, 5)], 2)).status).toBe(201);
    });

    it('is closed the same way by the sweep', async () => {
      const { reservationId } = await held(301);

      await ctx.app.get(HoldSweeper).sweepOnce();

      const r = await ctx.prisma.seatReservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { holds: true },
      });
      expect(r.endedAt).toEqual(r.expiresAt);
      expect(r.holds[0]).toMatchObject({ releasedAt: r.expiresAt, endReason: 'EXPIRED' });
    });

    it('leaves an active reservation alone in the sweep', async () => {
      const { reservationId } = await held(10);

      await ctx.app.get(HoldSweeper).sweepOnce();

      const r = await ctx.prisma.seatReservation.findUniqueOrThrow({
        where: { id: reservationId },
      });
      expect(r.endedAt).toBeNull();
    });
  });

  describe('the 2-minute wait (spec 015 FR-004a, spec 033 FR-006)', () => {
    const utc = (d: Date): string => `${d.toISOString().slice(11, 19)} UTC`;
    const release = async (seats: object[]) =>
      (await customer(ctx)).post(`/events/${eventId}/reservation/release`).send({ seats });

    /** Ends the reservation alone, `secondsAgo` before the database's now. */
    async function endReservation(reservationId: string, secondsAgo: number): Promise<Date> {
      await ctx.prisma.$executeRaw`
        UPDATE "SeatReservation" SET "endedAt" = now() - make_interval(secs => ${secondsAgo})
        WHERE "id" = ${reservationId}::uuid`;
      const r = await ctx.prisma.seatReservation.findUniqueOrThrow({
        where: { id: reservationId },
      });
      return r.endedAt as Date;
    }

    it.each(['EXPIRED', 'RELEASED', 'LOGOUT'])(
      "refuses the same customer one second before the reservation's end plus 2 minutes, after %s",
      async (reason) => {
        const { reservationId } = await held(250);
        await ended(reservationId, reason, 119);
        const r = await ctx.prisma.seatReservation.findUniqueOrThrow({
          where: { id: reservationId },
        });
        const availableAt = new Date((r.endedAt as Date).getTime() + 2 * 60_000);

        const res = await reserve([seat(1, 5), seat(1, 6)]);

        expect(res.status).toBe(409);
        expect(code(res)).toBe('SEAT_COOLDOWN');
        expect(res.body.error.details.seats).toEqual([{ section: 'A', row: 1, seat: 5 }]);
        expect(Date.parse(res.body.error.details.availableAt)).toBe(availableAt.getTime());
        expect(res.body.error.message).toBe(
          'Your reservation of Section A, Row 1, Seat 5 ended less than 2 minutes ago. ' +
            `You can reserve it again at ${utc(availableAt)}.`,
        );
        expect(await ctx.prisma.seatReservation.count({ where: { endedAt: null } })).toBe(0);
      },
    );

    it.each(['EXPIRED', 'RELEASED', 'LOGOUT'])(
      'lets the same customer reserve the seat again at exactly 2 minutes, after %s',
      async (reason) => {
        const { reservationId } = await held(250);
        await ended(reservationId, reason, 120);

        expect((await reserve([seat(1, 5)])).status).toBe(201);
      },
    );

    it('names every waiting seat and says "them"', async () => {
      const { reservationId } = await held(250, 1, [
        { section: 'A', row: 1, seat: 5 },
        { section: 'A', row: 1, seat: 6 },
      ]);
      await ended(reservationId, 'RELEASED', 30);

      const res = await reserve([seat(1, 6), seat(1, 5)]);

      expect(code(res)).toBe('SEAT_COOLDOWN');
      expect(res.body.error.details.seats).toEqual([
        { section: 'A', row: 1, seat: 5 },
        { section: 'A', row: 1, seat: 6 },
      ]);
      expect(res.body.error.message).toMatch(
        /^Your reservation of Section A, Row 1, Seat 5; Section A, Row 1, Seat 6 ended less than 2 minutes ago\. You can reserve them again at \d\d:\d\d:\d\d UTC\.$/,
      );
    });

    it.each(['BOUGHT', 'CLOSED'])('starts no wait after %s', async (reason) => {
      const { reservationId } = await held(250);
      await ended(reservationId, reason, 1);

      expect((await reserve([seat(1, 5)])).status).toBe(201);
    });

    it('never applies to another customer', async () => {
      const { reservationId } = await held(250);
      await ended(reservationId, 'RELEASED', 1);

      expect((await reserve([seat(1, 5)], 2)).status).toBe(201);
    });

    it('lets a seat released while the reservation keeps another be held again at once, through the API', async () => {
      const first = await reserve([seat(1, 5), seat(1, 6)]);
      expect(first.status).toBe(201);
      expect((await release([seat(1, 5)])).status).toBe(200);

      const again = await reserve([seat(1, 5)]);

      expect(again.status).toBe(200);
      expect(again.body.createdAt).toBe(first.body.createdAt);
      expect(again.body.expiresAt).toBe(first.body.expiresAt);
      expect(
        (again.body.seats as { row: number; seat: number }[]).map((s) => s.seat).sort(),
      ).toEqual([5, 6]);
    });

    it("counts a seat released early from the reservation's end, not its own release", async () => {
      // Made 359 s ago; seat 5 released at minute 1 (299 s ago); seat 6, and with it the
      // reservation, at minute 4 (119 s ago). Seat 5's own release + 2 minutes passed at minute 3.
      const { reservationId, holdIds } = await held(359, 1, [
        { section: 'A', row: 1, seat: 5 },
        { section: 'A', row: 1, seat: 6 },
      ]);
      await endHold(ctx.prisma, holdIds[0], 'RELEASED', 299);
      await endHold(ctx.prisma, holdIds[1], 'RELEASED', 119);
      const endedAt = await endReservation(reservationId, 119);

      const res = await reserve([seat(1, 5)]);

      expect(res.status).toBe(409);
      expect(code(res)).toBe('SEAT_COOLDOWN');
      expect(res.body.error.details.seats).toEqual([{ section: 'A', row: 1, seat: 5 }]);
      expect(Date.parse(res.body.error.details.availableAt)).toBe(endedAt.getTime() + 120_000);
    });

    it("lets that seat be held again at exactly 2 minutes after the reservation's end", async () => {
      const { reservationId, holdIds } = await held(360, 1, [
        { section: 'A', row: 1, seat: 5 },
        { section: 'A', row: 1, seat: 6 },
      ]);
      await endHold(ctx.prisma, holdIds[0], 'RELEASED', 300);
      await endHold(ctx.prisma, holdIds[1], 'RELEASED', 120);
      await endReservation(reservationId, 120);

      expect((await reserve([seat(1, 5)])).status).toBe(201);
    });

    it('refuses a seat released, held again, and bought in one reservation as taken, not waiting', async () => {
      expect((await reserve([seat(1, 5), seat(1, 6)])).status).toBe(201);
      expect((await release([seat(1, 5)])).status).toBe(200);
      expect((await reserve([seat(1, 5)])).status).toBe(200);
      expect((await order([seat(1, 5), seat(1, 6)])).status).toBe(201);

      const res = await reserve([seat(1, 5)]);

      expect(res.status).toBe(409);
      expect(code(res)).toBe('SEAT_TAKEN');
    });

    it("never blocks on a hold released more than 8 minutes ago (the query's bound)", async () => {
      // Not a state the Backend makes (a hold leaves at most 5 minutes and one transaction before
      // its reservation ends): it shows the bound on the hold's own release is applied.
      const { reservationId, holdIds } = await held(490);
      await endHold(ctx.prisma, holdIds[0], 'RELEASED', 481);
      await endReservation(reservationId, 60);

      expect((await reserve([seat(1, 5)])).status).toBe(201);
    });

    it('starts for every seat when the last one is released through the API', async () => {
      expect((await reserve([seat(1, 5), seat(1, 6)])).status).toBe(201);
      expect((await release([seat(1, 5)])).status).toBe(200);
      const last = await release([seat(1, 6)]);
      expect(last.status).toBe(200);
      expect(last.body.reservation).toBeNull();

      for (const s of [5, 6]) {
        const res = await reserve([seat(1, s)]);
        expect(res.status).toBe(409);
        expect(code(res)).toBe('SEAT_COOLDOWN');
      }
      // Another customer takes them at once.
      expect((await reserve([seat(1, 5), seat(1, 6)], 2)).status).toBe(201);
    });
  });
});
