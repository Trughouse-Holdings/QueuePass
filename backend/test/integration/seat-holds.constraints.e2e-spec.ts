import { randomUUID } from 'node:crypto';
import { asAdmin } from '../setup/authed-request';
import { event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 015 FR-009 (Constitution IV; research R2, R16): every seat-hold rule the database states on
 * its own, proven with rows written directly by SQL, below the Backend. The reserve path takes the
 * event lock first, so its concurrency tests never reach these indexes and CHECKs.
 */
describe('Seat hold rules below the Backend', () => {
  let ctx: TestContext;
  let eventId: string;
  let otherEventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const venueId = await venue(ctx, 'Seat Hall');
    await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({ sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }] })
      .expect(200);
    eventId = await event(ctx, venueId, { capacity: 30 });
    otherEventId = await event(ctx, venueId, { capacity: 30 });
  });

  /** A reservation row made by SQL, active unless `endedAt` is given. */
  async function reservation(
    customerSub: string,
    opts: { event?: string; endedAt?: 'now' } = {},
  ): Promise<string> {
    const id = randomUUID();
    const ended = opts.endedAt === 'now';
    // Times are the database's (research R3), so the CHECKs compare like with like.
    await ctx.prisma.$executeRaw`
      INSERT INTO "SeatReservation" ("id", "eventId", "customerSub", "createdAt", "expiresAt", "endedAt")
      VALUES (${id}::uuid, ${opts.event ?? eventId}::uuid, ${customerSub}, now(),
              now() + interval '5 minutes', CASE WHEN ${ended} THEN now() END)`;
    return id;
  }

  /** A hold row made by SQL on Section A; live unless `released` is given. */
  function hold(
    reservationId: string,
    seat: number,
    opts: { event?: string; released?: boolean } = {},
  ): Promise<number> {
    return ctx.prisma.$executeRaw`
      INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatSection", "seatRow",
                              "seatNumber", "createdAt", "releasedAt", "endReason")
      VALUES (${randomUUID()}::uuid, ${reservationId}::uuid, ${opts.event ?? eventId}::uuid, 'A', 1,
              ${seat}, now(), CASE WHEN ${opts.released === true} THEN now() END,
              ${opts.released ? 'RELEASED' : null}::"SeatHoldEnd")`;
  }

  it('refuses a second live hold on the same seat of the same event', async () => {
    const first = await reservation('sub-1');
    const second = await reservation('sub-2');
    await hold(first, 5);

    await expect(hold(second, 5)).rejects.toThrow(/seat_hold_one_live_per_seat|23505/);
  });

  it('accepts a live hold on a seat whose earlier hold has ended', async () => {
    const first = await reservation('sub-1');
    const second = await reservation('sub-2');
    await hold(first, 5, { released: true });

    await expect(hold(second, 5)).resolves.toBe(1);
  });

  it('refuses a second active reservation for the same customer and event', async () => {
    await reservation('sub-1');

    await expect(reservation('sub-1')).rejects.toThrow(/seat_reservation_one_active|23505/);
  });

  it('accepts an active reservation beside an ended one for the same customer and event', async () => {
    await reservation('sub-1', { endedAt: 'now' });

    await expect(reservation('sub-1')).resolves.toEqual(expect.any(String));
  });

  it('refuses a reservation whose expiresAt is not createdAt + 5 minutes', async () => {
    await expect(
      ctx.prisma.$executeRaw`
        INSERT INTO "SeatReservation" ("id", "eventId", "customerSub", "createdAt", "expiresAt")
        VALUES (${randomUUID()}::uuid, ${eventId}::uuid, 'sub-1', now(),
                now() + interval '6 minutes')`,
    ).rejects.toThrow(/seat_reservation_five_minutes|23514/);
  });

  it('refuses a hold with releasedAt but no endReason, and the reverse', async () => {
    const r = await reservation('sub-1');

    await expect(
      ctx.prisma.$executeRaw`
        INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatSection", "seatRow",
                                "seatNumber", "createdAt", "releasedAt")
        VALUES (${randomUUID()}::uuid, ${r}::uuid, ${eventId}::uuid, 'A', 1, 1, now(), now())`,
    ).rejects.toThrow(/seat_hold_end_all_or_none|23514/);
    await expect(
      ctx.prisma.$executeRaw`
        INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatSection", "seatRow",
                                "seatNumber", "createdAt", "endReason")
        VALUES (${randomUUID()}::uuid, ${r}::uuid, ${eventId}::uuid, 'A', 1, 2, now(),
                'RELEASED')`,
    ).rejects.toThrow(/seat_hold_end_all_or_none|23514/);
  });

  it("refuses a hold whose eventId differs from its reservation's", async () => {
    const r = await reservation('sub-1');

    await expect(hold(r, 5, { event: otherEventId })).rejects.toThrow(
      /seat_hold_reservation_event|23503/,
    );
  });
});
