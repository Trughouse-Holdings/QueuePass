import { anon, as, asAdmin } from '../setup/authed-request';
import { customer, event, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { AGENT, tokenFor } from '../setup/tokens';

/** Spec 006 US3 (FR-007, SC-003; research R4): a customer's own orders, and no one else's. */
describe('My orders', () => {
  let ctx: TestContext;
  let venueId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Yum Center');
  });

  const buy = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/orders`).send(body).expect(201);
  const mine = async (n = 1) => (await customer(ctx, n)).get('/me/orders').expect(200);

  it("lists the customer's orders newest first, with tickets and an event summary", async () => {
    const opener = await event(ctx, venueId, { name: 'Opener' });
    const vip = await tier(ctx, opener, 'VIP', '120.00', 10);
    const later = await event(ctx, venueId, { name: 'Later', basePrice: '20.00' });
    const first = await buy(opener, { tierId: vip, quantity: 2 });
    const second = await buy(later, { quantity: 1 });

    const res = await mine();

    expect(res.body.map((o: { id: string }) => o.id)).toEqual([second.body.id, first.body.id]);
    expect(res.body[1]).toMatchObject({
      tierName: 'VIP',
      quantity: 2,
      totalPrice: '240.00',
      status: 'CONFIRMED',
      event: {
        id: opener,
        name: 'Opener',
        status: 'SCHEDULED',
        location: { id: venueId, name: 'Yum Center' },
      },
    });
    expect(res.body[1].tickets.map((t: { code: string }) => t.code).sort()).toEqual(
      first.body.tickets.map((t: { code: string }) => t.code).sort(),
    );
  });

  it("never shows one customer another customer's orders", async () => {
    const eventId = await event(ctx, venueId);
    await buy(eventId, { quantity: 1 }, 1);

    expect((await mine(2)).body).toEqual([]);
    expect((await mine(1)).body).toHaveLength(1);
  });

  it('shows a cancelled event as cancelled, its order refunded, and its tickets void', async () => {
    const eventId = await event(ctx, venueId);
    await buy(eventId, { quantity: 2 });
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const [order] = (await mine()).body;

    expect(order.status).toBe('REFUNDED');
    expect(order.refundedAt).not.toBeNull();
    expect(order.event.status).toBe('CANCELLED');
    expect(order.tickets.map((t: { status: string }) => t.status)).toEqual(['VOID', 'VOID']);
  });

  it('shows when a ticket was checked in', async () => {
    const eventId = await event(ctx, venueId);
    const placed = await buy(eventId, { quantity: 1 });
    const at = new Date();
    await ctx.prisma.ticket.update({
      where: { id: placed.body.tickets[0].id },
      data: { checkedInAt: at },
    });

    const [order] = (await mine()).body;

    expect(new Date(order.tickets[0].checkedInAt).getTime()).toBe(at.getTime());
  });

  it("leaves out orders placed under a stand-in subject, as the demo script's are", async () => {
    const eventId = await event(ctx, venueId);
    const standIn = await tokenFor({
      username: 'customer1',
      roles: ['customer'],
      sub: 'demo-customer1',
    });
    await as(ctx, standIn).post(`/events/${eventId}/orders`).send({ quantity: 1 }).expect(201);

    expect((await mine(1)).body).toEqual([]);
  });

  it('refuses admins and gate agents, and requests without a token', async () => {
    await asAdmin(ctx).get('/me/orders').expect(403);
    await as(ctx, await tokenFor(AGENT))
      .get('/me/orders')
      .expect(403);
    await anon(ctx).get('/me/orders').expect(401);
  });
});
