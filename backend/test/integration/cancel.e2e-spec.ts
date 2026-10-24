import { asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, tier, venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 005 US4 (FR-008–FR-011): cancelling safely, and protecting records that have sales. */
describe('Cancellation and sales protections', () => {
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

  const buy = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, ...body })
      .expect(201);

  it('voids every ticket, refunds every order, marks the event cancelled, and reports counts', async () => {
    const eventId = await event(ctx, venueId);
    await buy(eventId, { quantity: 2 }, 1);
    await buy(eventId, { quantity: 3 }, 2);

    const res = await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    expect(res.body).toMatchObject({ ordersRefunded: 2, ticketsVoided: 5 });
    expect(res.body.event.status).toBe('CANCELLED');
    expect(res.body.event.cancelledAt).toEqual(expect.any(String));

    expect(await ctx.prisma.ticket.count({ where: { eventId, status: 'VALID' } })).toBe(0);
    const orders = await ctx.prisma.order.findMany({ where: { eventId } });
    expect(orders.every((o) => o.status === 'REFUNDED' && o.refundedAt)).toBe(true);
    await asAdmin(ctx)
      .get(`/events/${eventId}`)
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('CANCELLED'));
  });

  it('cancels an event with no orders, reporting zero', async () => {
    const eventId = await event(ctx, venueId);
    const res = await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    expect(res.body).toMatchObject({ ordersRefunded: 0, ticketsVoided: 0 });
  });

  it('makes a cancelled event read-only', async () => {
    const eventId = await event(ctx, venueId);
    const tierId = await tier(ctx, eventId, 'General', '10.00', 10);
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const code = (r: { body: { error: { code: string } } }) => r.body.error.code;
    expect(code(await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(409))).toBe(
      'EVENT_CANCELLED',
    );
    expect(
      code(await asAdmin(ctx).patch(`/events/${eventId}`).send({ name: 'X' }).expect(409)),
    ).toBe('EVENT_CANCELLED');
    expect(
      code(
        await asAdmin(ctx)
          .post(`/events/${eventId}/tiers`)
          .send({ name: 'VIP', price: '1.00', quantity: 1 })
          .expect(409),
      ),
    ).toBe('EVENT_CANCELLED');
    expect(
      code(
        await asAdmin(ctx)
          .patch(`/events/${eventId}/tiers/${tierId}`)
          .send({ quantity: 5 })
          .expect(409),
      ),
    ).toBe('EVENT_CANCELLED');
    expect(code(await asAdmin(ctx).delete(`/events/${eventId}/tiers/${tierId}`).expect(409))).toBe(
      'EVENT_CANCELLED',
    );
    const order = await (
      await customer(ctx)
    )
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, tierId, quantity: 1 });
    expect(order.status).toBe(409);
    expect(code(order)).toBe('EVENT_CANCELLED');
  });

  it("frees the cancelled event's venue time", async () => {
    const window = windowAt(516);
    const eventId = await event(ctx, venueId, window);
    // Same slot is refused while it is scheduled …
    await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Rival',
        locationId: venueId,
        ...window,
        totalTicketCapacity: 10,
        basePrice: '1.00',
      })
      .expect(409);
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    // … and accepted once it is cancelled.
    await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Rival',
        locationId: venueId,
        ...window,
        totalTicketCapacity: 10,
        basePrice: '1.00',
      })
      .expect(201);
  });

  it('settles two simultaneous cancels: one succeeds, one is told it is already cancelled', async () => {
    const eventId = await event(ctx, venueId);
    await buy(eventId, { quantity: 2 });
    const [a, b] = await Promise.all([
      asAdmin(ctx).post(`/events/${eventId}/cancel`),
      asAdmin(ctx).post(`/events/${eventId}/cancel`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('refuses deleting an event that has orders, and still deletes one without', async () => {
    const sold = await event(ctx, venueId);
    await buy(sold, { quantity: 1 });
    await buy(sold, { quantity: 1 }, 2);
    const res = await asAdmin(ctx).delete(`/events/${sold}`).expect(409);
    expect(res.body.error.code).toBe('EVENT_HAS_ORDERS');
    expect(res.body.error.details).toEqual({ orderCount: 2 });
    // Cancelling does not make it deletable: its records are kept.
    await asAdmin(ctx).post(`/events/${sold}/cancel`).expect(200);
    await asAdmin(ctx).delete(`/events/${sold}`).expect(409);

    const unsold = await event(ctx, venueId);
    await asAdmin(ctx).delete(`/events/${unsold}`).expect(204);
  });

  it('refuses removing a tier that has orders', async () => {
    const eventId = await event(ctx, venueId);
    const vip = await tier(ctx, eventId, 'VIP', '50.00', 10);
    await buy(eventId, { tierId: vip, quantity: 1 });
    const res = await asAdmin(ctx).delete(`/events/${eventId}/tiers/${vip}`).expect(409);
    expect(res.body.error.code).toBe('TIER_HAS_ORDERS');
  });

  it('refuses shrinking the event or a tier below tickets sold', async () => {
    const eventId = await event(ctx, venueId, { capacity: 100 });
    const vip = await tier(ctx, eventId, 'VIP', '50.00', 10);
    await buy(eventId, { tierId: vip, quantity: 6 });

    const tierRes = await asAdmin(ctx)
      .patch(`/events/${eventId}/tiers/${vip}`)
      .send({ quantity: 5 })
      .expect(409);
    expect(tierRes.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(tierRes.body.error.details).toMatchObject({ requested: 5, ticketsSold: 6 });
    await asAdmin(ctx).patch(`/events/${eventId}/tiers/${vip}`).send({ quantity: 6 }).expect(200);

    // The tier total (6) is below the sold count here only if sales outran tiers; check the
    // event-level rule with a tierless event instead.
    const plain = await event(ctx, venueId, { capacity: 20 });
    await buy(plain, { quantity: 8 });
    const evRes = await asAdmin(ctx)
      .patch(`/events/${plain}`)
      .send({ totalTicketCapacity: 7 })
      .expect(409);
    expect(evRes.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(evRes.body.error.details).toMatchObject({ proposedTicketCapacity: 7, ticketsSold: 8 });
    await asAdmin(ctx).patch(`/events/${plain}`).send({ totalTicketCapacity: 8 }).expect(200);
  });

  it('refuses the first tier on an event that already sold tickets without tiers', async () => {
    const eventId = await event(ctx, venueId);
    await buy(eventId, { quantity: 1 });
    const res = await asAdmin(ctx)
      .post(`/events/${eventId}/tiers`)
      .send({ name: 'VIP', price: '1.00', quantity: 1 })
      .expect(409);
    expect(res.body.error.code).toBe('EVENT_HAS_ORDERS');
  });
});
