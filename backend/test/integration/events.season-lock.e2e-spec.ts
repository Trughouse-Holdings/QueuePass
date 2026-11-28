import { asAdmin } from '../setup/authed-request';
import { atInstant, seatedLayout, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { seasonWithSoldPass } from '../setup/season-fixtures';

/**
 * Spec 041 FR-007, FR-015 (research R9): an event in a Season can't change its venue, layout or
 * seating kind, move its start before the Season's sales end, or (general admission) rename or
 * delete the ticket type whose name the Season prices; an event in any Season can't be deleted.
 * Each is `409 EVENT_IN_SEASON` naming the Season. Cancelling an event refunds its pass order
 * like any order, and the pass stays active.
 */
describe('Events in a Season (041 FR-007, FR-015)', () => {
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

  const patch = (id: string, body: object) => asAdmin(ctx).patch(`/events/${id}`).send(body);
  const seasonName = async (id: string) =>
    (await ctx.prisma.season.findUniqueOrThrow({ where: { id } })).name;

  const expectInSeason = async (
    res: { status: number; body: { error: { code: string; details: unknown } } },
    field: string,
    seasonId: string,
  ) => {
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_IN_SEASON');
    expect(res.body.error.details).toMatchObject({
      field,
      seasonId,
      seasonName: await seasonName(seasonId),
    });
  };

  describe('a seated event in the fixture Season', () => {
    it('refuses another venue, another layout, or general admission, before the sold-seat check', async () => {
      const f = await seasonWithSoldPass(ctx);
      const elsewhere = await venue(ctx, 'Elsewhere');
      await expectInSeason(
        await patch(f.eventIds[0], { locationId: elsewhere }),
        'locationId',
        f.seasonId,
      );

      const other = await seatedLayout(ctx, f.venueId, [{ name: 'Z', rows: 1, seatsPerRow: 2 }]);
      await expectInSeason(
        await patch(f.eventIds[1], {
          layoutId: other.id,
          levelPrices: [{ levelId: other.levels.Standard, price: '10.00' }],
        }),
        'layoutId',
        f.seasonId,
      );
      await expectInSeason(
        await patch(f.eventIds[2], { layoutId: null, totalTicketCapacity: 5 }),
        'layoutId',
        f.seasonId,
      );
    });

    it('refuses moving the start before the sales end, and allows a later start', async () => {
      const f = await seasonWithSoldPass(ctx, { sold: false });
      const e = await ctx.prisma.event.findUniqueOrThrow({ where: { id: f.eventIds[0] } });
      const earlier = (ms: number) => atInstant(e.startsAt.getTime() - ms);
      const res = await patch(f.eventIds[0], {
        startsAt: earlier(86_400_000),
        endsAt: atInstant(e.endsAt.getTime() - 86_400_000),
      });
      await expectInSeason(res, 'startsAt', f.seasonId);
      expect(res.body.error.message).toContain('sales end');

      await patch(f.eventIds[0], {
        startsAt: atInstant(e.startsAt.getTime() + 3_600_000),
        endsAt: atInstant(e.endsAt.getTime() + 3_600_000),
      }).expect(200);
    });

    it('still saves other changes, such as the name and level prices', async () => {
      const f = await seasonWithSoldPass(ctx);
      const res = await patch(f.eventIds[1], { name: 'Renamed game' }).expect(200);
      expect(res.body.name).toBe('Renamed game');
    });

    it('lets a cancelled Season’s events change their layout again', async () => {
      const f = await seasonWithSoldPass(ctx, { sold: false });
      await asAdmin(ctx).post(`/seasons/${f.seasonId}/cancel`).expect(200);
      await patch(f.eventIds[0], { layoutId: null, totalTicketCapacity: 5 }).expect(200);
    });

    it('refuses deleting an event in any Season, a cancelled one included', async () => {
      const f = await seasonWithSoldPass(ctx, { status: 'DRAFT' });
      await expectInSeason(await asAdmin(ctx).delete(`/events/${f.eventIds[0]}`), 'id', f.seasonId);

      const g = await seasonWithSoldPass(ctx, { sold: false });
      await asAdmin(ctx).post(`/seasons/${g.seasonId}/cancel`).expect(200);
      await expectInSeason(await asAdmin(ctx).delete(`/events/${g.eventIds[2]}`), 'id', g.seasonId);
      expect(await ctx.prisma.event.count({ where: { id: g.eventIds[2] } })).toBe(1);
    });

    it('cancelling an event refunds its pass order like any order; the pass stays active', async () => {
      const f = await seasonWithSoldPass(ctx);
      const res = await asAdmin(ctx).post(`/events/${f.eventIds[1]}/cancel`).expect(200);
      expect(res.body.ordersRefunded).toBe(1);
      const order = await ctx.prisma.order.findUniqueOrThrow({
        where: { id: f.pass!.orders[1].orderId },
      });
      expect(order.status).toBe('REFUNDED');
      const pass = await ctx.prisma.seasonPass.findUniqueOrThrow({ where: { id: f.pass!.id } });
      expect(pass.status).toBe('ACTIVE');
      const others = await ctx.prisma.order.findMany({
        where: { id: { in: [f.pass!.orders[0].orderId, f.pass!.orders[2].orderId] } },
      });
      expect(others.every((o) => o.status === 'CONFIRMED')).toBe(true);
    });
  });

  describe('a general-admission event in the fixture Season', () => {
    it('refuses renaming the priced ticket type, ignoring case, through its tier and the event', async () => {
      const f = await seasonWithSoldPass(ctx, { kind: 'ga', sold: false });
      const tierPath = `/events/${f.eventIds[0]}/tiers/${f.tierIds[0]}`;
      await expectInSeason(
        await asAdmin(ctx).patch(tierPath).send({ name: 'Standing' }),
        'name',
        f.seasonId,
      );
      // A change of case keeps the name the Season prices.
      await asAdmin(ctx).patch(tierPath).send({ name: 'GENERAL' }).expect(200);
      await asAdmin(ctx).patch(tierPath).send({ price: '41.00' }).expect(200);

      const viaEvent = await patch(f.eventIds[1], {
        tiers: [{ id: f.tierIds[1], name: 'Lawn', price: '40.00', quantity: 50 }],
      });
      await expectInSeason(viaEvent, 'tiers', f.seasonId);
    });

    it('refuses deleting the priced ticket type, through its tier and the event', async () => {
      const f = await seasonWithSoldPass(ctx, { kind: 'ga', sold: false });
      await expectInSeason(
        await asAdmin(ctx).delete(`/events/${f.eventIds[0]}/tiers/${f.tierIds[0]}`),
        'tierId',
        f.seasonId,
      );
      await expectInSeason(
        await patch(f.eventIds[1], { tiers: [{ name: 'Other', price: '5.00', quantity: 5 }] }),
        'tiers',
        f.seasonId,
      );
      // Another ticket type can still be added beside it.
      await patch(f.eventIds[2], {
        tiers: [
          { id: f.tierIds[2], name: 'General', price: '40.00', quantity: 40 },
          { name: 'VIP', price: '90.00', quantity: 5 },
        ],
      }).expect(200);
    });
  });
});
