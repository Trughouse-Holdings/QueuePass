import { anon, as, asAdmin } from '../setup/authed-request';
import { atInstant, customer, event, HOLDER, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/** Spec 006 FR-002, FR-014 (research R1): tickets left, and whether sales are closed. */
describe('Event availability', () => {
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
  const availability = (eventId: string) =>
    asAdmin(ctx).get(`/events/${eventId}/availability`).expect(200);

  /** An event that started a minute ago and is still running. */
  const started = () => {
    const start = Date.now() - 60_000;
    return {
      startsAt: atInstant(start),
      endsAt: atInstant(start + 3 * 3_600_000),
    };
  };

  it('counts tickets left for an event without tiers', async () => {
    const eventId = await event(ctx, venueId, { capacity: 10 });
    await buy(eventId, { quantity: 3 });

    const res = await availability(eventId);
    expect(res.body).toEqual({
      eventId,
      ticketsLeft: 7,
      salesClosed: null,
      tiers: [],
      customerLimit: null,
    });
  });

  it("counts each tier's tickets left, in the tier list's order", async () => {
    const eventId = await event(ctx, venueId, { capacity: 100 });
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 10);
    const general = await tier(ctx, eventId, 'General', '40.00', 60);
    await buy(eventId, { tierId: vip, quantity: 4 }, 1);
    await buy(eventId, { tierId: general, quantity: 10 }, 2);

    const tiers = await asAdmin(ctx).get(`/events/${eventId}/tiers`).expect(200);
    const res = await availability(eventId);
    expect(res.body.ticketsLeft).toBe(86);
    expect(res.body.tiers).toEqual(
      tiers.body.map((t: { id: string }) => ({
        tierId: t.id,
        ticketsLeft: t.id === vip ? 6 : 50,
      })),
    );
  });

  it('reports a sold-out event as 0 left', async () => {
    const eventId = await event(ctx, venueId, { capacity: 2 });
    await buy(eventId, { quantity: 2 });
    expect((await availability(eventId)).body.ticketsLeft).toBe(0);
  });

  it('says sales are closed once the event has started', async () => {
    const eventId = await event(ctx, venueId, started());
    expect((await availability(eventId)).body.salesClosed).toBe('STARTED');
  });

  it('says cancelled, not started, for a cancelled event, and its void tickets do not count', async () => {
    const eventId = await event(ctx, venueId, { capacity: 10 });
    await buy(eventId, { quantity: 3 });
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    expect((await availability(eventId)).body).toMatchObject({
      ticketsLeft: 10,
      salesClosed: 'CANCELLED',
    });

    const startedThenCancelled = await event(ctx, venueId, started());
    await asAdmin(ctx).post(`/events/${startedThenCancelled}/cancel`).expect(200);
    expect((await availability(startedThenCancelled)).body.salesClosed).toBe('CANCELLED');
  });

  it('answers 404 for an unknown event and 400 for a malformed id', async () => {
    await asAdmin(ctx).get('/events/7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40/availability').expect(404);
    await asAdmin(ctx).get('/events/not-a-uuid/availability').expect(400);
  });

  it('lets any signed-in user read it, and refuses without a token', async () => {
    const eventId = await event(ctx, venueId);
    await as(ctx, await tokenFor(CUSTOMER))
      .get(`/events/${eventId}/availability`)
      .expect(200);
    await as(ctx, await tokenFor(AGENT))
      .get(`/events/${eventId}/availability`)
      .expect(200);
    await anon(ctx).get(`/events/${eventId}/availability`).expect(401);
  });

  describe("the caller's own standing against the limit (spec 016 FR-012; research R5)", () => {
    const mine = async (eventId: string, n = 1) =>
      (await customer(ctx, n)).get(`/events/${eventId}/availability`).expect(200);

    it('gives a customer the limit, what they hold, and what is left, without void tickets', async () => {
      const eventId = await event(ctx, venueId, { maxTicketsPerCustomer: 8 });
      expect((await mine(eventId)).body.customerLimit).toEqual({ limit: 8, held: 0, remaining: 8 });

      const placed = await buy(eventId, { quantity: 5 });
      await ctx.prisma.ticket.update({
        where: { id: placed.body.tickets[0].id },
        data: { status: 'VOID' },
      });
      expect((await mine(eventId)).body.customerLimit).toEqual({ limit: 8, held: 4, remaining: 4 });
    });

    it('never reports a negative remainder after the limit is lowered below what is held', async () => {
      const eventId = await event(ctx, venueId, { maxTicketsPerCustomer: 8 });
      await buy(eventId, { quantity: 6 });
      await asAdmin(ctx).patch(`/events/${eventId}`).send({ maxTicketsPerCustomer: 4 }).expect(200);
      expect((await mine(eventId)).body.customerLimit).toEqual({ limit: 4, held: 6, remaining: 0 });
    });

    it('is null for an event with no limit', async () => {
      const eventId = await event(ctx, venueId);
      await buy(eventId, { quantity: 2 });
      expect((await mine(eventId)).body).toHaveProperty('customerLimit', null);
    });

    it('is null for an admin or a gate agent', async () => {
      const eventId = await event(ctx, venueId, { maxTicketsPerCustomer: 8 });
      expect((await availability(eventId)).body).toHaveProperty('customerLimit', null);
      const agent = await as(ctx, await tokenFor(AGENT))
        .get(`/events/${eventId}/availability`)
        .expect(200);
      expect(agent.body).toHaveProperty('customerLimit', null);
    });

    it("never shows one customer another's count", async () => {
      const eventId = await event(ctx, venueId, { maxTicketsPerCustomer: 8 });
      await buy(eventId, { quantity: 6 }, 1);
      expect((await mine(eventId, 2)).body.customerLimit).toEqual({
        limit: 8,
        held: 0,
        remaining: 8,
      });
    });
  });
});
