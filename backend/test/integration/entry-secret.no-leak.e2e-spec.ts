import { keyToBase64url, windowAt as liveWindowAt } from '@queuepass/shared';
import { asAdmin } from '../setup/authed-request';
import {
  HOLDER,
  agent,
  customer,
  event,
  eventAroundNow,
  liveCodeFor,
  orderWithTickets,
  venue,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 018 FR-006 (research R1, R5): no response but getTicketEntryKey, for its own ticket,
 * carries a ticket's entry secret, in base64url or hex, or even the word entrySecret.
 */
describe('Entry secrets never leak', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => resetDb(ctx.prisma));
  afterEach(() => ctx.clock.useRealTime());

  it('appears only in its own ticket’s entry key', async () => {
    const venueId = await venue(ctx);
    const gate = await eventAroundNow(ctx, venueId, { startsInSeconds: 3600, lastsSeconds: 10800 });
    const onSale = await event(ctx, venueId, { name: 'On Sale' });
    const { tickets } = await orderWithTickets(ctx, gate, { quantity: 2 });
    const [a, b] = tickets;

    const me = await customer(ctx);
    const agent1 = await agent(ctx);
    const w = liveWindowAt(Date.now());
    ctx.clock.set(w * 30_000 + 15_000);

    const texts: string[] = [];
    const record = (res: { status: number; text: string }, status: number) => {
      expect(res.status).toBe(status);
      texts.push(res.text);
    };
    record(
      await me.post(`/events/${onSale}/orders`).send({ holderName: HOLDER, quantity: 2 }),
      201,
    );
    record(await me.get('/me/orders'), 200);
    record(await asAdmin(ctx).get(`/events/${gate}/attendees`), 200);
    record(await asAdmin(ctx).get(`/events/${onSale}/attendees`), 200);
    record(await asAdmin(ctx).get('/reports/sales'), 200);
    record(await agent1.post(`/events/${gate}/entry/lookup`).send({ code: a.code }), 200);
    record(
      await agent1
        .post(`/events/${gate}/entry/lookup`)
        .send({ code: await liveCodeFor(ctx, a.id, w) }),
      200,
    );
    record(
      await agent1.post(`/events/${gate}/entry/admit`).send({ ticketId: a.id, wholeOrder: false }),
      200,
    );
    record(
      await agent1.post(`/events/${gate}/entry/admit`).send({ ticketId: a.id, wholeOrder: false }),
      409,
    );

    // Every ticket's secret, including the order just created through the API.
    const all = await ctx.prisma.ticket.findMany({ select: { id: true, entrySecret: true } });
    expect(all).toHaveLength(4);
    const forms = (s: Uint8Array) => [keyToBase64url(s), Buffer.from(s).toString('hex')];
    for (const text of texts) {
      expect(text).not.toMatch(/entrySecret/i);
      for (const t of all) {
        for (const form of forms(t.entrySecret)) expect(text).not.toContain(form);
      }
    }

    const keyText = (await me.get(`/me/tickets/${b.id}/entry-key`).expect(200)).text;
    const secretOf = (id: string) => all.find((t) => t.id === id)!.entrySecret;
    expect(keyText).toContain(keyToBase64url(secretOf(b.id)));
    expect(keyText).not.toContain(keyToBase64url(secretOf(a.id)));
    expect(keyText).not.toMatch(/entrySecret/i);
  });
});
