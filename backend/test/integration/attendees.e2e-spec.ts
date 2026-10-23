import { asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 005 US3 (FR-007): every order for an event, with its tickets. */
describe('Attendee list', () => {
  let ctx: TestContext;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    eventId = await event(ctx, await venue(ctx));
  });

  it('is empty before anyone has tickets', async () => {
    await asAdmin(ctx)
      .get(`/events/${eventId}/attendees`)
      .expect(200)
      .expect((r) => expect(r.body).toEqual([]));
  });

  it('lists every order oldest first, with tier names, ticket codes, and check-in state', async () => {
    const vip = await tier(ctx, eventId, 'VIP', '99.00', 10);
    const general = await tier(ctx, eventId, 'General', '10.00', 50);
    const first = await (
      await customer(ctx, 3)
    )
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, tierId: vip, quantity: 2 })
      .expect(201);
    await (
      await customer(ctx, 1)
    )
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, tierId: general, quantity: 1 })
      .expect(201);
    await ctx.prisma.ticket.update({
      where: { id: first.body.tickets[0].id },
      data: { checkedInAt: new Date() },
    });

    const res = await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);
    expect(res.body.map((o: { customerUsername: string }) => o.customerUsername)).toEqual([
      'customer3',
      'customer1',
    ]);
    expect(res.body[0]).toMatchObject({ tierName: 'VIP', quantity: 2, totalPrice: '198.00' });
    const codes = res.body[0].tickets.map((t: { code: string }) => t.code).sort();
    expect(codes).toEqual(first.body.tickets.map((t: { code: string }) => t.code).sort());
    const checked = res.body[0].tickets.filter(
      (t: { checkedInAt: string | null }) => t.checkedInAt,
    );
    expect(checked).toHaveLength(1);
  });

  it('includes refunded orders after a cancel', async () => {
    await (await customer(ctx)).post(`/events/${eventId}/orders`).send({ holderName: HOLDER, quantity: 1 }).expect(201);
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    const res = await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);
    expect(res.body[0].status).toBe('REFUNDED');
    expect(res.body[0].tickets[0].status).toBe('VOID');
  });

  it('is 404 for an unknown event', async () => {
    await asAdmin(ctx).get('/events/7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40/attendees').expect(404);
  });
});
