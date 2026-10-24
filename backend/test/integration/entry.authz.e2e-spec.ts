import { anon, as, asAdmin } from '../setup/authed-request';
import { agent, customer, eventAroundNow, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 017 FR-016 (Constitution V): only gate agents look tickets up for entry or admit them,
 * enforced by the Backend on both operations, even through the API directly.
 */
describe('Entry authorization', () => {
  let ctx: TestContext;
  let eventId: string;
  let ticketId: string;
  let code: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    eventId = await eventAroundNow(ctx, await venue(ctx), {
      startsInSeconds: 3600,
      lastsSeconds: 10800,
    });
    const placed = await orderWithTickets(ctx, eventId, { quantity: 1 });
    ticketId = placed.tickets[0].id;
    code = placed.tickets[0].code;
  });

  const paths = () =>
    [
      { path: `/events/${eventId}/entry/lookup`, body: { code } },
      { path: `/events/${eventId}/entry/admit`, body: { ticketId, wholeOrder: false } },
    ] as const;

  it('answers 401 with no token on both operations', async () => {
    for (const { path, body } of paths()) {
      const res = await anon(ctx).post(path).send(body);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('answers 401 with an expired token', async () => {
    const expired = await tokenFor({ username: 'agent1', roles: ['gate-agent'], expiresIn: -60 });
    for (const { path, body } of paths()) {
      await as(ctx, expired).post(path).send(body).expect(401);
    }
  });

  it('answers 401 with a wrongly signed token', async () => {
    const rogue = await tokenFor({ username: 'agent1', roles: ['gate-agent'], rogue: true });
    for (const { path, body } of paths()) {
      await as(ctx, rogue).post(path).send(body).expect(401);
    }
  });

  it('answers 401 with a token for another audience (Constitution VI)', async () => {
    const elsewhere = await tokenFor({ username: 'agent1', roles: ['gate-agent'], aud: 'account' });
    for (const { path, body } of paths()) {
      await as(ctx, elsewhere).post(path).send(body).expect(401);
    }
  });

  it('answers 403 for a customer and for an admin', async () => {
    for (const { path, body } of paths()) {
      await (await customer(ctx)).post(path).send(body).expect(403);
      await asAdmin(ctx).post(path).send(body).expect(403);
    }
    // Nothing was admitted by any refused call.
    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.checkedInAt).toBeNull();
  });

  it('succeeds for a gate agent on both operations', async () => {
    await (await agent(ctx)).post(`/events/${eventId}/entry/lookup`).send({ code }).expect(200);
    await (
      await agent(ctx)
    )
      .post(`/events/${eventId}/entry/admit`)
      .send({ ticketId, wholeOrder: false })
      .expect(200);
  });
});
