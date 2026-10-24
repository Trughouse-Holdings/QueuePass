import { windowAt as liveWindowAt } from '@queuepass/shared';
import { anon, as, asAdmin } from '../setup/authed-request';
import {
  agent,
  customer,
  eventAroundNow,
  liveCodeFor,
  orderWithTickets,
  venue,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 018 FR-003, FR-013, SC-007 (Constitution V, VI): only a ticket's buyer gets its entry
 * key, and only gate agents look a live code up, enforced by the Backend.
 */
describe('Live code authorization', () => {
  let ctx: TestContext;
  let eventId: string;
  let ticketId: string;

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
    ticketId = (await orderWithTickets(ctx, eventId, { quantity: 1 })).tickets[0].id;
  });

  const path = () => `/me/tickets/${ticketId}/entry-key`;

  it('answers 401 with no token', async () => {
    const res = await anon(ctx).get(path());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 with an expired, a wrongly signed, and a wrong-audience token', async () => {
    const tokens = [
      await tokenFor({ username: 'customer1', roles: ['customer'], expiresIn: -60 }),
      await tokenFor({ username: 'customer1', roles: ['customer'], rogue: true }),
      await tokenFor({ username: 'customer1', roles: ['customer'], aud: 'account' }),
    ];
    for (const token of tokens) await as(ctx, token).get(path()).expect(401);
  });

  it('answers 403 for an admin and for a gate agent', async () => {
    await asAdmin(ctx).get(path()).expect(403);
    await (await agent(ctx)).get(path()).expect(403);
  });

  it('answers 200 for the buyer', async () => {
    await (await customer(ctx)).get(path()).expect(200);
  });

  it('answers 403 to a customer looking up a current live code (FR-013)', async () => {
    const code = await liveCodeFor(ctx, ticketId, liveWindowAt(Date.now()));
    await (await customer(ctx)).post(`/events/${eventId}/entry/lookup`).send({ code }).expect(403);
  });
});
