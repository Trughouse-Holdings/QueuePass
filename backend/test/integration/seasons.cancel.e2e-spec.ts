import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { as, asAdmin } from '../setup/authed-request';
import { orderWithTickets } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { seasonWithSoldPass } from '../setup/season-fixtures';
import { CUSTOMER, subFor, tokenFor } from '../setup/tokens';

/**
 * Spec 041 FR-014, SC-006 (research R10): cancelling a Season refunds every pass in one step:
 * each pass order refunded and its tickets voided, each pass refunded, live pass holds ended, the
 * Season cancelled; its events stay scheduled. A failure part way leaves nothing changed.
 */
describe('cancelSeason (041 FR-014)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  const cancel = (id: string) => asAdmin(ctx).post(`/seasons/${id}/cancel`);

  /** A live pass hold of one seat at every event, written directly as 042 will. */
  async function passHold(seasonId: string, eventIds: string[], seatId: string) {
    const [{ now }] = await ctx.prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`;
    const hold = await ctx.prisma.seasonPassHold.create({
      data: {
        seasonId,
        customerSub: subFor('customer3'),
        seatId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
      },
    });
    for (const eventId of eventIds) {
      const reservation = await ctx.prisma.seatReservation.create({
        data: {
          eventId,
          customerSub: subFor('customer3'),
          createdAt: now,
          expiresAt: new Date(now.getTime() + 5 * 60_000),
          passHoldId: hold.id,
        },
      });
      await ctx.prisma.seatHold.create({
        data: {
          reservationId: reservation.id,
          eventId,
          seatSection: '101',
          seatRow: 3,
          seatNumber: 4,
          seatId,
          createdAt: now,
        },
      });
    }
    return hold.id;
  }

  it('refunds the pass, voids its tickets, ends pass holds, and cancels the Season only', async () => {
    const f = await seasonWithSoldPass(ctx);
    const holdId = await passHold(f.seasonId, f.eventIds, f.layout!.seat('101', 3, 4));
    // A single ticket at one of the events stays as it is.
    const single = await orderWithTickets(ctx, f.eventIds[1], { quantity: 1, holderName: 'Solo' });

    const res = await cancel(f.seasonId).expect(200);
    expect(res.body).toMatchObject({ passesRefunded: 1, ordersRefunded: 3, ticketsVoided: 3 });
    expect(res.body.season).toMatchObject({
      status: 'CANCELLED',
      salesOpen: false,
      passesSold: 0,
      passRevenue: '0.00',
    });
    expect(res.body.season.cancelledAt).not.toBeNull();

    const pass = await ctx.prisma.seasonPass.findUniqueOrThrow({ where: { id: f.pass!.id } });
    expect(pass.status).toBe('REFUNDED');
    expect(pass.refundedAt).not.toBeNull();
    const orders = await ctx.prisma.order.findMany({
      where: { seasonPassId: f.pass!.id },
      include: { tickets: true },
    });
    expect(orders.every((o) => o.status === 'REFUNDED' && o.refundedAt !== null)).toBe(true);
    expect(orders.flatMap((o) => o.tickets).every((t) => t.status === 'VOID')).toBe(true);

    const hold = await ctx.prisma.seasonPassHold.findUniqueOrThrow({ where: { id: holdId } });
    expect(hold.endedAt).not.toBeNull();
    const holds = await ctx.prisma.seatHold.findMany({
      where: { reservation: { passHoldId: holdId } },
    });
    expect(holds.every((h) => h.endReason === 'CLOSED' && h.releasedAt !== null)).toBe(true);
    const reservations = await ctx.prisma.seatReservation.findMany({
      where: { passHoldId: holdId },
    });
    expect(reservations.every((r) => r.endedAt !== null)).toBe(true);

    const events = await ctx.prisma.event.findMany({ where: { id: { in: f.eventIds } } });
    expect(events.every((e) => e.status === 'SCHEDULED')).toBe(true);
    const solo = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: single.orderId },
      include: { tickets: true },
    });
    expect(solo.status).toBe('CONFIRMED');
    expect(solo.tickets[0].status).toBe('VALID');
  });

  it('refunds pass orders already refunded by an event cancel only once', async () => {
    const f = await seasonWithSoldPass(ctx);
    await asAdmin(ctx).post(`/events/${f.eventIds[2]}/cancel`).expect(200);
    const res = await cancel(f.seasonId).expect(200);
    expect(res.body).toMatchObject({ passesRefunded: 1, ordersRefunded: 2, ticketsVoided: 2 });
  });

  it('works for a general-admission Season', async () => {
    const f = await seasonWithSoldPass(ctx, { kind: 'ga' });
    const res = await cancel(f.seasonId).expect(200);
    expect(res.body).toMatchObject({ passesRefunded: 1, ordersRefunded: 3, ticketsVoided: 3 });
  });

  it('leaves nothing changed when a step fails part way (SC-006)', async () => {
    const f = await seasonWithSoldPass(ctx);
    // The last step (the Season's status) fails, after the refunds were written in the same
    // transaction; the contract declares no 500, so this one call is not checked against it.
    await ctx.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_season_cancel() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'cancel failed on purpose'; END; $$ LANGUAGE plpgsql`);
    await ctx.prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_season_cancel BEFORE UPDATE OF "status" ON "Season"
      FOR EACH ROW WHEN (NEW."status" = 'CANCELLED') EXECUTE FUNCTION fail_season_cancel()`);
    try {
      const res = await request(ctx.app.getHttpServer())
        .post(`/seasons/${f.seasonId}/cancel`)
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(res.status).toBe(500);
    } finally {
      await ctx.prisma.$executeRawUnsafe('DROP TRIGGER fail_season_cancel ON "Season"');
      await ctx.prisma.$executeRawUnsafe('DROP FUNCTION fail_season_cancel()');
    }
    const pass = await ctx.prisma.seasonPass.findUniqueOrThrow({ where: { id: f.pass!.id } });
    expect(pass.status).toBe('ACTIVE');
    const orders = await ctx.prisma.order.findMany({
      where: { seasonPassId: f.pass!.id },
      include: { tickets: true },
    });
    expect(orders.every((o) => o.status === 'CONFIRMED')).toBe(true);
    expect(orders.flatMap((o) => o.tickets).every((t) => t.status === 'VALID')).toBe(true);
    const season = await ctx.prisma.season.findUniqueOrThrow({ where: { id: f.seasonId } });
    expect(season.status).toBe('ON_SALE');
  });

  it('refuses a draft (409 SEASON_NOT_ON_SALE) and a cancelled Season (409 SEASON_CANCELLED)', async () => {
    const draft = await seasonWithSoldPass(ctx, { status: 'DRAFT' });
    const res = await cancel(draft.seasonId).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'SEASON_NOT_ON_SALE',
      details: { status: 'DRAFT' },
    });

    const f = await seasonWithSoldPass(ctx);
    await cancel(f.seasonId).expect(200);
    expect((await cancel(f.seasonId).expect(409)).body.error.code).toBe('SEASON_CANCELLED');
  });

  it('is for admins only, and 404s for a Season that does not exist', async () => {
    const f = await seasonWithSoldPass(ctx);
    const token = await tokenFor(CUSTOMER);
    await as(ctx, token).post(`/seasons/${f.seasonId}/cancel`).expect(403);
    await cancel(randomUUID()).expect(404);
  });
});
