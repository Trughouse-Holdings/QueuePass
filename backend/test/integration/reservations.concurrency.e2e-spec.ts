import type { Response } from 'supertest';
import {
  HOLDER,
  customer,
  holdSeats,
  seatedEvent,
  venue,
  type InsertedLayout,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor } from '../setup/tokens';

/**
 * Spec 015 US2 (FR-009, SC-001; Constitution IV, VI; research R2): no seat is ever in two active
 * reservations, or in one and on a valid ticket, under genuinely simultaneous requests. Each case
 * runs 5 times. Spec 038 (FR-025): a seat is claimed by its id, whatever its level.
 */
describe('Reservations under concurrency', () => {
  let ctx: TestContext;
  let eventId: string;
  let layout: InsertedLayout;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const venueId = await venue(ctx, 'Seat Hall');
    ({ eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }],
    }));
  });

  const code = (res: Response): string => res.body.error?.code;
  const seat = (row: number, s: number) => ({ sectionId: layout.sections.A, row, seat: s });
  const reserve = async (n: number, seats: object[]) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation`).send({ seats });
  /** Valid tickets plus live holds on one seat: never more than 1. */
  const claims = async (row: number, s: number): Promise<number> => {
    const seatId = layout.seat('A', row, s);
    return (
      (await ctx.prisma.ticket.count({ where: { eventId, status: 'VALID', seatId } })) +
      (await ctx.prisma.seatHold.count({ where: { eventId, releasedAt: null, seatId } }))
    );
  };
  const reset = () =>
    ctx.prisma.$executeRawUnsafe('TRUNCATE TABLE "SeatHold", "SeatReservation", "Ticket", "Order"');

  it('lets exactly 1 of 10 customers reserving the same seat at once succeed (5 runs)', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, (_, i) => customer(ctx, i + 1)));
    for (let run = 0; run < 5; run++) {
      await reset();

      const results = await Promise.all(
        clients.map((c) => c.post(`/events/${eventId}/reservation`).send({ seats: [seat(1, 1)] })),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const refused = results.filter((r) => r.status !== 201);
      expect(refused).toHaveLength(9);
      for (const r of refused) {
        expect(r.status).toBe(409);
        expect(code(r)).toBe('SEAT_TAKEN');
        expect(r.body.error.details.reserved).toEqual([{ section: 'A', row: 1, seat: 1 }]);
      }
      expect(await claims(1, 1)).toBe(1);
    }
  });

  it("gives one customer's 10 simultaneous reservations one reservation, never two (5 runs)", async () => {
    const me = await customer(ctx, 1);
    for (let run = 0; run < 5; run++) {
      await reset();

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          me.post(`/events/${eventId}/reservation`).send({ seats: [seat(2, i + 1)] }),
        ),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const r of results) expect([200, 201]).toContain(r.status);
      const active = await ctx.prisma.seatReservation.findMany({
        where: { eventId, customerSub: subFor('customer1'), endedAt: null },
        include: { holds: true },
      });
      expect(active).toHaveLength(1);
      expect(active[0].holds).toHaveLength(10);
    }
  });

  it('leaves a seat reserved or sold, never both, when an order and a reservation race (5 runs)', async () => {
    const buyer = await customer(ctx, 1);
    for (let run = 0; run < 5; run++) {
      await reset();
      // The buyer's reservation is active in even runs and has run out (unclosed) in odd ones, so
      // either side may win.
      await holdSeats(ctx.prisma, {
        eventId,
        customerSub: subFor('customer1'),
        seats: [{ section: 'A', row: 3, seat: 3, seatId: layout.seat('A', 3, 3) }],
        secondsAgo: run % 2 === 0 ? 10 : 301,
      });

      const [ordered, reserved] = await Promise.all([
        buyer
          .post(`/events/${eventId}/orders`)
          .send({ holderName: HOLDER, quantity: 1, seats: [seat(3, 3)] }),
        reserve(2, [seat(3, 3)]),
      ]);

      expect([ordered.status, reserved.status].filter((s) => s === 201)).toHaveLength(1);
      expect(await claims(3, 3)).toBe(1);
    }
  });
});
