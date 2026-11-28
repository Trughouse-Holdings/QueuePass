import { asAdmin } from '../setup/authed-request';
import { customer, orderWithTickets } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { seasonWithSoldPass, type SeasonFixture } from '../setup/season-fixtures';

/**
 * Spec 041 US3 (FR-020; research R8): the sales report gives each event's pass tickets and pass
 * revenue, part of its sold and revenue figures, and their totals; the attendee list and the
 * customer's orders mark each order bought on a pass with its Season. A refunded pass counts
 * nowhere. Checked against contract 2.2.0 by the request helpers.
 */
describe('Pass sales in reports (041 US3)', () => {
  let ctx: TestContext;
  let f: SeasonFixture;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    f = await seasonWithSoldPass(ctx);
  });

  const report = async () => (await asAdmin(ctx).get('/reports/sales').expect(200)).body;
  const rowOf = (body: { events: { eventId: string }[] }, id: string) =>
    body.events.find((e) => e.eventId === id) as Record<string, unknown>;

  it("gives each event its pass ticket and share, and the totals the pass's whole price", async () => {
    // A single ticket beside the pass, at the first event.
    await orderWithTickets(ctx, f.eventIds[0], { quantity: 1, holderName: 'Solo', customer: 2 });
    const body = await report();
    expect(f.eventIds.map((id) => rowOf(body, id).passTicketsSold)).toEqual([1, 1, 1]);
    expect(f.eventIds.map((id) => rowOf(body, id).passRevenue)).toEqual([
      '33.34',
      '33.33',
      '33.33',
    ]);
    // Part of, not added to, the event's figures.
    expect(rowOf(body, f.eventIds[0])).toMatchObject({ ticketsSold: 2, revenue: '78.34' });
    expect(body.totals).toMatchObject({
      passTicketsSold: 3,
      passRevenue: '100.00',
      ticketsSold: 4,
      revenue: '145.00',
    });
  });

  it('counts a cancelled Season’s pass nowhere', async () => {
    await asAdmin(ctx).post(`/seasons/${f.seasonId}/cancel`).expect(200);
    const body = await report();
    expect(f.eventIds.map((id) => rowOf(body, id).passTicketsSold)).toEqual([0, 0, 0]);
    expect(f.eventIds.map((id) => rowOf(body, id).passRevenue)).toEqual(['0.00', '0.00', '0.00']);
    expect(body.totals).toMatchObject({ passTicketsSold: 0, passRevenue: '0.00' });
  });

  it('gives an event with no pass orders zeros', async () => {
    const other = await seasonWithSoldPass(ctx, { sold: false });
    const body = await report();
    expect(rowOf(body, other.eventIds[0])).toMatchObject({
      passTicketsSold: 0,
      passRevenue: '0.00',
    });
  });

  it('marks the pass order in the attendee list with its Season, and single orders null', async () => {
    const single = await orderWithTickets(ctx, f.eventIds[1], { quantity: 1, holderName: 'Solo' });
    const season = await ctx.prisma.season.findUniqueOrThrow({ where: { id: f.seasonId } });
    const res = await asAdmin(ctx).get(`/events/${f.eventIds[1]}/attendees`).expect(200);
    const pass = res.body.find((o: { id: string }) => o.id === f.pass!.orders[1].orderId);
    expect(pass.seasonPass).toEqual({
      id: f.pass!.id,
      seasonId: f.seasonId,
      seasonName: season.name,
    });
    const solo = res.body.find((o: { id: string }) => o.id === single.orderId);
    expect(solo.seasonPass).toBeNull();
  });

  it("marks the pass orders in the customer's own orders", async () => {
    const res = await (await customer(ctx, 1)).get('/me/orders').expect(200);
    const passOrders = res.body.filter((o: { seasonPass: unknown }) => o.seasonPass !== null);
    expect(passOrders).toHaveLength(3);
    expect(
      passOrders.every(
        (o: { seasonPass: { seasonId: string } }) => o.seasonPass.seasonId === f.seasonId,
      ),
    ).toBe(true);
  });
});
