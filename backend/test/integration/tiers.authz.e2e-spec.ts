import { anon, as, asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/** Spec 004 FR-005, Constitution V — anyone signed in reads tiers; only admins change them. */
describe('Ticket tier authorization', () => {
  let ctx: TestContext;
  let eventId: string;
  let tierId: string;
  const tokens: Record<'customer' | 'agent', string> = { customer: '', agent: '' };

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
    const { body: venue } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Yum Center', ...ADDRESS, seatingCapacity: 22090 });
    const { body: event } = await asAdmin(ctx).post('/events').send({
      name: 'Season Opener',
      locationId: venue.id,
      startsAt: '2026-11-01T18:00:00-05:00',
      endsAt: '2026-11-01T21:00:00-05:00',
      totalTicketCapacity: 1000,
      basePrice: '45.00',
    });
    eventId = event.id;
    tierId = (
      await asAdmin(ctx)
        .post(`/events/${eventId}/tiers`)
        .send({ name: 'VIP', price: '120.00', quantity: 100 })
    ).body.id;
  });

  for (const role of ['customer', 'agent'] as const) {
    it(`lets a ${role} list tiers`, async () => {
      await as(ctx, tokens[role]).get(`/events/${eventId}/tiers`).expect(200);
    });

    it(`refuses every tier write from a ${role} with 403 and changes nothing`, async () => {
      const client = as(ctx, tokens[role]);
      await client
        .post(`/events/${eventId}/tiers`)
        .send({ name: 'Floor', price: '1.00', quantity: 1 })
        .expect(403);
      await client.patch(`/events/${eventId}/tiers/${tierId}`).send({ quantity: 1 }).expect(403);
      await client.delete(`/events/${eventId}/tiers/${tierId}`).expect(403);
      const rows = await ctx.prisma.ticketTier.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(100);
    });
  }

  it('refuses every tier operation without a token', async () => {
    await anon(ctx).get(`/events/${eventId}/tiers`).expect(401);
    await anon(ctx)
      .post(`/events/${eventId}/tiers`)
      .send({ name: 'Floor', price: '1.00', quantity: 1 })
      .expect(401);
    await anon(ctx).patch(`/events/${eventId}/tiers/${tierId}`).send({ quantity: 1 }).expect(401);
    await anon(ctx).delete(`/events/${eventId}/tiers/${tierId}`).expect(401);
  });
});
