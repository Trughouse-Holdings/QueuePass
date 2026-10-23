import { asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor } from '../setup/tokens';

/** Spec 005 US1 (FR-001–FR-004): orders and tickets, and never overselling. */
describe('Orders', () => {
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
    venueId = await venue(ctx);
  });

  const order = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/orders`).send({ holderName: HOLDER, ...body });

  it('sells tickets for an event without tiers at its base price, one unique code per seat', async () => {
    const eventId = await event(ctx, venueId, { basePrice: '45.50' });
    const res = await order(eventId, { quantity: 2 }).then((r) => r);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      eventId,
      tierId: null,
      tierName: null,
      customerUsername: 'customer1',
      quantity: 2,
      unitPrice: '45.50',
      totalPrice: '91.00',
      status: 'CONFIRMED',
      refundedAt: null,
    });
    const codes = res.body.tickets.map((t: { code: string }) => t.code);
    expect(codes).toHaveLength(2);
    expect(new Set(codes).size).toBe(2);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{12}$/);
    expect(res.body.tickets.every((t: { status: string }) => t.status === 'VALID')).toBe(true);
  });

  it('records the customer from the token, never from the request', async () => {
    const eventId = await event(ctx, venueId);
    const res = await order(eventId, { quantity: 1 }, 7);
    expect(res.status).toBe(201);
    const row = await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.customerUsername).toBe('customer7');
    expect(row.customerSub).toBe(subFor('customer7'));
  });

  it('sells a tier at the tier price with an exact total', async () => {
    const eventId = await event(ctx, venueId, { capacity: 100 });
    const vip = await tier(ctx, eventId, 'VIP', '120.35', 10);
    const res = await order(eventId, { tierId: vip, quantity: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tierId: vip,
      tierName: 'VIP',
      unitPrice: '120.35',
      totalPrice: '361.05',
    });
  });

  it('requires a tier for an event with tiers, and refuses one for an event without', async () => {
    const tiered = await event(ctx, venueId);
    await tier(ctx, tiered, 'General', '10.00', 50);
    expect((await order(tiered, { quantity: 1 })).status).toBe(400);

    const plain = await event(ctx, venueId);
    const otherTier = await tier(ctx, tiered, 'VIP', '20.00', 5);
    expect((await order(plain, { tierId: otherTier, quantity: 1 })).status).toBe(400);
  });

  it("treats another event's tier as not found", async () => {
    const a = await event(ctx, venueId);
    const b = await event(ctx, venueId);
    await tier(ctx, a, 'General', '10.00', 10);
    const bTier = await tier(ctx, b, 'General', '10.00', 10);
    expect((await order(a, { tierId: bTier, quantity: 1 })).status).toBe(404);
  });

  it.each([0, 11, 1.5, '2'])('refuses quantity %p with 400', async (quantity) => {
    const eventId = await event(ctx, venueId);
    expect((await order(eventId, { quantity })).status).toBe(400);
  });

  it('is 404 for an unknown event', async () => {
    expect((await order('7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40', { quantity: 1 })).status).toBe(404);
  });

  it('fills the event exactly, then refuses one more, saying how many are available', async () => {
    const eventId = await event(ctx, venueId, { capacity: 5 });
    expect((await order(eventId, { quantity: 4 })).status).toBe(201);
    const over = await order(eventId, { quantity: 2 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('SOLD_OUT');
    expect(over.body.error.details).toEqual({ available: 1, requested: 2 });
    expect((await order(eventId, { quantity: 1 })).status).toBe(201);
    expect((await order(eventId, { quantity: 1 })).body.error.details.available).toBe(0);
    expect(await ctx.prisma.ticket.count({ where: { eventId } })).toBe(5);
  });

  it('enforces the tier quantity, independently of other tiers', async () => {
    const eventId = await event(ctx, venueId, { capacity: 100 });
    const vip = await tier(ctx, eventId, 'VIP', '100.00', 2);
    const general = await tier(ctx, eventId, 'General', '10.00', 50);
    expect((await order(eventId, { tierId: vip, quantity: 2 })).status).toBe(201);
    const over = await order(eventId, { tierId: vip, quantity: 1 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('SOLD_OUT');
    expect((await order(eventId, { tierId: general, quantity: 10 })).status).toBe(201);
  });

  it('keeps the price an order was placed at when the tier price changes later', async () => {
    const eventId = await event(ctx, venueId);
    const vip = await tier(ctx, eventId, 'VIP', '100.00', 10);
    const placed = await order(eventId, { tierId: vip, quantity: 1 });
    await asAdmin(ctx)
      .patch(`/events/${eventId}/tiers/${vip}`)
      .send({ price: '150.00' })
      .expect(200);
    const row = await ctx.prisma.order.findUniqueOrThrow({ where: { id: placed.body.id } });
    expect(row.unitPrice.toFixed(2)).toBe('100.00');
  });

  it('never oversells under 20 simultaneous orders against capacity 10', async () => {
    const eventId = await event(ctx, venueId, { capacity: 10 });
    const clients = await Promise.all(Array.from({ length: 20 }, (_, i) => customer(ctx, i + 1)));
    const results = await Promise.all(
      clients.map((c) => c.post(`/events/${eventId}/orders`).send({ holderName: HOLDER, quantity: 1 })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(10);
    expect(await ctx.prisma.ticket.count({ where: { eventId, status: 'VALID' } })).toBe(10);
  });

  it('never oversells a tier under simultaneous orders', async () => {
    const eventId = await event(ctx, venueId, { capacity: 100 });
    const vip = await tier(ctx, eventId, 'VIP', '50.00', 6);
    const clients = await Promise.all(Array.from({ length: 10 }, (_, i) => customer(ctx, i + 1)));
    await Promise.all(
      clients.map((c) => c.post(`/events/${eventId}/orders`).send({ holderName: HOLDER, tierId: vip, quantity: 2 })),
    );
    expect(await ctx.prisma.ticket.count({ where: { tierId: vip, status: 'VALID' } })).toBe(6);
  });
});
