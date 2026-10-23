import { anon, as, asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/**
 * Spec 005 FR-003, FR-014, Constitution V — only customers order; only admins see attendees,
 * cancel, and read the sales report.
 */
describe('Order, attendee, cancel, and report authorization', () => {
  let ctx: TestContext;
  let eventId: string;
  const tokens = { customer: '', agent: '' };

  beforeAll(async () => {
    ctx = await createTestApp();
    tokens.customer = await tokenFor(CUSTOMER);
    tokens.agent = await tokenFor(AGENT);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    eventId = await event(ctx, await venue(ctx));
  });

  it('refuses orders from an admin or a gate agent with 403', async () => {
    await asAdmin(ctx).post(`/events/${eventId}/orders`).send({ holderName: HOLDER, quantity: 1 }).expect(403);
    await as(ctx, tokens.agent).post(`/events/${eventId}/orders`).send({ holderName: HOLDER, quantity: 1 }).expect(403);
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('lets a customer order', async () => {
    await (await customer(ctx)).post(`/events/${eventId}/orders`).send({ holderName: HOLDER, quantity: 1 }).expect(201);
  });

  for (const role of ['customer', 'agent'] as const) {
    it(`refuses attendees, cancel, and reports to a ${role} with 403`, async () => {
      const c = as(ctx, tokens[role]);
      await c.get(`/events/${eventId}/attendees`).expect(403);
      await c.post(`/events/${eventId}/cancel`).expect(403);
      await c.get('/reports/sales').expect(403);
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      expect(row.status).toBe('SCHEDULED');
    });
  }

  it('refuses all four without a token', async () => {
    await anon(ctx).post(`/events/${eventId}/orders`).send({ holderName: HOLDER, quantity: 1 }).expect(401);
    await anon(ctx).get(`/events/${eventId}/attendees`).expect(401);
    await anon(ctx).post(`/events/${eventId}/cancel`).expect(401);
    await anon(ctx).get('/reports/sales').expect(401);
  });
});
