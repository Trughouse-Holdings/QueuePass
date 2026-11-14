import { randomUUID } from 'node:crypto';
import { seatedEvent, seatedLayout, venue, type InsertedLayout } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 015 FR-009 (Constitution IV; research R2, R16): every seat-hold rule the database states on
 * its own, proven with rows written directly by SQL, below the Backend. The reserve path takes the
 * event lock first, so its concurrency tests never reach these indexes and CHECKs. Spec 038
 * (FR-025, research R10): one live hold per seat by the seat itself (`seatId`), and a live hold
 * always has its seat.
 */
describe('Seat hold rules below the Backend', () => {
  let ctx: TestContext;
  let eventId: string;
  let otherEventId: string;
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
    layout = await seatedLayout(ctx, venueId, [{ name: 'A', rows: 3, seatsPerRow: 10 }]);
    eventId = (await seatedEvent(ctx, venueId, { layout })).eventId;
    otherEventId = (await seatedEvent(ctx, venueId, { layout })).eventId;
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

  /**
   * A hold row made by SQL on Section A, row 1, with its seat (`seatId`, spec 038) unless
   * `seatId: null`; live unless `released` is given. `label` writes another seat's label beside
   * the seat, as no Backend path would.
   */
  function hold(
    reservationId: string,
    seat: number,
    opts: { event?: string; released?: boolean; seatId?: string | null; label?: number } = {},
  ): Promise<number> {
    const seatId = opts.seatId === undefined ? layout.seat('A', 1, seat) : opts.seatId;
    return ctx.prisma.$executeRaw`
      INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatId", "seatSection", "seatRow",
                              "seatNumber", "createdAt", "releasedAt", "endReason")
      VALUES (${randomUUID()}::uuid, ${reservationId}::uuid, ${opts.event ?? eventId}::uuid,
              ${seatId}::uuid, 'A', 1, ${opts.label ?? seat}, now(),
              CASE WHEN ${opts.released === true} THEN now() END,
              ${opts.released ? 'RELEASED' : null}::"SeatHoldEnd")`;
  }

  it('refuses a second live hold on the same seat of the same event', async () => {
    const first = await reservation('sub-1');
    const second = await reservation('sub-2');
    await hold(first, 5);

    await expect(hold(second, 5)).rejects.toThrow(/seat_hold_one_live_per_seat|23505/);
  });

  it('refuses a second live hold on the same seat even under another label (by seatId)', async () => {
    const first = await reservation('sub-1');
    const second = await reservation('sub-2');
    await hold(first, 5);

    await expect(hold(second, 5, { label: 6 })).rejects.toThrow(
      /seat_hold_one_live_per_seat|23505/,
    );
  });

  it('accepts live holds on the same seat of two events', async () => {
    const first = await reservation('sub-1');
    const other = await reservation('sub-1', { event: otherEventId });
    await hold(first, 5);

    await expect(hold(other, 5, { event: otherEventId })).resolves.toBe(1);
  });

  it('refuses a live hold without its seat, and accepts an ended one without it', async () => {
    const r = await reservation('sub-1');

    await expect(hold(r, 5, { seatId: null })).rejects.toThrow(/seat_hold_live_has_seat|23514/);
    await expect(hold(r, 5, { seatId: null, released: true })).resolves.toBe(1);
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
        INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatId", "seatSection",
                                "seatRow", "seatNumber", "createdAt", "releasedAt")
        VALUES (${randomUUID()}::uuid, ${r}::uuid, ${eventId}::uuid, ${layout.seat('A', 1, 1)}::uuid,
                'A', 1, 1, now(), now())`,
    ).rejects.toThrow(/seat_hold_end_all_or_none/);
    await expect(
      ctx.prisma.$executeRaw`
        INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatId", "seatSection",
                                "seatRow", "seatNumber", "createdAt", "endReason")
        VALUES (${randomUUID()}::uuid, ${r}::uuid, ${eventId}::uuid, ${layout.seat('A', 1, 2)}::uuid,
                'A', 1, 2, now(), 'RELEASED')`,
    ).rejects.toThrow(/seat_hold_end_all_or_none/);
  });

  it("refuses a hold whose eventId differs from its reservation's", async () => {
    const r = await reservation('sub-1');

    await expect(hold(r, 5, { event: otherEventId })).rejects.toThrow(
      /seat_hold_reservation_event|23503/,
    );
  });
});
