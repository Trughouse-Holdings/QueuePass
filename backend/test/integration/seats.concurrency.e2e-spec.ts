import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import {
  HOLDER,
  customer,
  reserveThenOrder,
  seatedEvent,
  venue,
  type InsertedLayout,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 038 US3 (FR-025, SC-001; Constitution IV, VI; research R10): a seat is held by at most one
 * live hold and one valid ticket per event, by the seat itself, under genuinely concurrent
 * requests (`Promise.all`, each request on its own connection): 10 customers holding one seat,
 * the holder's 10 orders for it, two valid tickets written below the Backend, and an admin taking
 * the seat off sale while 10 customers try to hold it. Before 038: spec 007 US3, spec 015.
 */
describe('One hold and one valid ticket per seat (038 US3)', () => {
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
      sections: [
        { name: 'A', rows: 3, seatsPerRow: 10, level: 'Front' },
        { name: 'B', rows: 1, seatsPerRow: 10, level: 'Back' },
      ],
      levels: [
        { name: 'Front', price: '95.00' },
        { name: 'Back', price: '60.00' },
      ],
    }));
  });

  const code = (res: Response): string => res.body.error?.code;
  const seat = (row: number, s: number, section = 'A') => ({
    sectionId: layout.sections[section],
    row,
    seat: s,
  });
  const order = async (n: number, seats: object[]) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: seats.length, seats, requestId: randomUUID() });
  const bought = async (n: number, seats: { sectionId: string; row: number; seat: number }[]) =>
    reserveThenOrder(
      ctx,
      await tokenFor({ username: `customer${n}`, roles: ['customer'] }),
      eventId,
      { seats },
    );
  /** Valid tickets plus live holds on one seat, by the seat itself: never more than 1. */
  const claims = async (seatId: string): Promise<number> =>
    (await ctx.prisma.ticket.count({ where: { eventId, status: 'VALID', seatId } })) +
    (await ctx.prisma.seatHold.count({ where: { eventId, releasedAt: null, seatId } }));
  const reset = () =>
    ctx.prisma.$executeRawUnsafe('TRUNCATE TABLE "SeatHold", "SeatReservation", "Ticket", "Order"');

  it('lets exactly 1 of 10 customers holding the same seat at once succeed (3 runs)', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, (_, i) => customer(ctx, i + 1)));
    for (let run = 0; run < 3; run++) {
      await reset();

      const results = await Promise.all(
        clients.map((c) => c.post(`/events/${eventId}/reservation`).send({ seats: [seat(1, 1)] })),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const refused = results.filter((r) => r.status !== 201);
      expect(refused.map((r) => [r.status, code(r)])).toEqual(
        Array.from({ length: 9 }, () => [409, 'SEAT_TAKEN']),
      );
      expect(await claims(layout.seat('A', 1, 1))).toBe(1);
    }
  });

  it("lets exactly 1 of the holder's 10 simultaneous orders for the seat succeed", async () => {
    await (
      await customer(ctx, 1)
    )
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(1, 1)] })
      .expect(201);

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
        where: { eventId, status: 'VALID', seatId: layout.seat('A', 1, 1) },
      }),
    ).toBe(1);
    expect(await claims(layout.seat('A', 1, 1))).toBe(1);
  });

  it('lets exactly one of two simultaneous overlapping orders succeed', async () => {
    await (
      await customer(ctx, 1)
    )
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(2, 1), seat(2, 2), seat(2, 3)] })
      .expect(201);

    const [first, second] = await Promise.all([
      order(1, [seat(2, 1), seat(2, 2)]),
      order(1, [seat(2, 2), seat(2, 3)]),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await ctx.prisma.ticket.count({ where: { eventId, status: 'VALID' } })).toBe(2);
  });

  it('holds below the Backend: of two valid tickets for one seat written at once, the database refuses one', async () => {
    const placed = await bought(1, [seat(3, 3)]);
    expect(placed.status).toBe(201);
    const orderId = placed.body.id as string;
    await ctx.prisma.ticket.updateMany({ where: { orderId }, data: { status: 'VOID' } });
    const seatId = layout.seat('A', 3, 3);
    const insert = (code: string) =>
      ctx.prisma.$executeRaw`
        INSERT INTO "Ticket" ("id", "orderId", "eventId", "code", "status", "seatId", "seatSection",
                              "seatRow", "seatNumber", "seatRowLabel", "seatLabel", "levelName",
                              "price")
        VALUES (gen_random_uuid(), ${orderId}::uuid, ${eventId}::uuid, ${code}, 'VALID',
                ${seatId}::uuid, 'A', 3, 3, '3', '3', 'Front', 95.00)`;

    const results = await Promise.allSettled([insert('ZZZZ2222ZZZZ'), insert('YYYY3333YYYY')]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [refused] = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(String(refused.reason)).toMatch(/23505|unique/i);
    expect(
      await ctx.prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE indexname = 'ticket_one_valid_per_seat'`,
    ).toEqual([{ indexdef: expect.stringMatching(/\("eventId", "seatId"\) WHERE/) }]);
    expect(await ctx.prisma.ticket.count({ where: { eventId, status: 'VALID', seatId } })).toBe(1);
  });

  it('lets either the off-sale save or a hold win when an admin takes a seat off sale while 10 customers hold it, never both (5 runs)', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, (_, i) => customer(ctx, i + 1)));
    const seatId = layout.seat('B', 1, 5);
    const outcomes = new Set<string>();
    for (let run = 0; run < 5; run++) {
      await reset();
      await asAdmin(ctx).patch(`/events/${eventId}`).send({ offSale: [] }).expect(200);

      const [save, ...holds] = await Promise.all([
        asAdmin(ctx)
          .patch(`/events/${eventId}`)
          .send({ offSale: [seat(1, 5, 'B')] }),
        ...clients.map((c) =>
          c.post(`/events/${eventId}/reservation`).send({ seats: [seat(1, 5, 'B')] }),
        ),
      ]);

      const held = holds.filter((r) => r.status === 201);
      const offSale = await ctx.prisma.eventOffSaleSeat.count({ where: { eventId, seatId } });
      if (save.status === 200) {
        // The save won: the seat is off sale and nobody holds it.
        outcomes.add('offSale');
        expect(held).toHaveLength(0);
        expect(offSale).toBe(1);
        for (const r of holds) expect([r.status, code(r)]).toEqual([409, 'SEAT_OFF_SALE']);
      } else {
        // A hold won: exactly one, and the save was refused naming the seat.
        outcomes.add('held');
        expect([save.status, code(save)]).toEqual([409, 'SEAT_TAKEN']);
        expect(held).toHaveLength(1);
        expect(offSale).toBe(0);
        for (const r of holds.filter((x) => x.status !== 201)) {
          expect([r.status, code(r)]).toEqual([409, 'SEAT_TAKEN']);
        }
      }
      expect(await claims(seatId)).toBe(save.status === 200 ? 0 : 1);
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  });

  it('frees every seat when the event is cancelled', async () => {
    await bought(1, [seat(1, 1), seat(1, 2)]).then((r) => expect(r.status).toBe(201));

    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const map = await asAdmin(ctx).get(`/events/${eventId}/venue-map`).expect(200);
    expect(map.body.sections[0].counts[0]).toMatchObject({ open: 30, sold: 0, reserved: 0 });
  });
});
