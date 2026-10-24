import { randomUUID } from 'node:crypto';
import { keyFromBase64url } from '@queuepass/shared';
import { asAdmin } from '../setup/authed-request';
import { agent, customer, eventAroundNow, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 018 research R5 (FR-003, FR-005): getTicketEntryKey, contract-checked. The buyer gets the
 * ticket's 32-byte secret and the Backend's time; nobody else learns whether the ticket exists.
 */
describe('getTicketEntryKey', () => {
  let ctx: TestContext;
  let venueId: string;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx);
    eventId = await eventAroundNow(ctx, venueId, { startsInSeconds: 3600, lastsSeconds: 10800 });
  });
  afterEach(() => ctx.clock.useRealTime());

  const keyOf = async (ticketId: string, n = 1) =>
    (await customer(ctx, n)).get(`/me/tickets/${ticketId}/entry-key`);

  const storedSecret = async (ticketId: string): Promise<Uint8Array> =>
    (
      await ctx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { entrySecret: true },
      })
    ).entrySecret;

  it("gives the buyer the ticket's secret and the Backend's time, not cached", async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1, holderName: 'Jo Lee' });
    const now = Date.UTC(2026, 9, 24, 22, 31, 7, 412);
    ctx.clock.set(now);
    const res = await keyOf(tickets[0].id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      ticketId: tickets[0].id,
      key: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      serverTime: '2026-10-24T22:31:07.412Z',
    });
    expect(res.body.serverTime).toBe(new Date(ctx.clock.now()).toISOString());
    expect(keyFromBase64url(res.body.key)).toEqual(
      new Uint8Array(await storedSecret(tickets[0].id)),
    );
  });

  it("is 404 NOT_FOUND for another customer's ticket and for a random id alike", async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1, customer: 2 });
    const theirs = await keyOf(tickets[0].id, 1);
    const random = await keyOf(randomUUID(), 1);
    for (const res of [theirs, random]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(Object.keys(res.body.error)).toEqual(['code', 'message']);
    }
    expect(theirs.body.error.message).toBe(`No ticket exists with id ${tickets[0].id}.`);
    // The owner still gets it.
    expect((await keyOf(tickets[0].id, 2)).status).toBe(200);
  });

  it('is 400 VALIDATION_FAILED for an id that is not a UUID', async () => {
    const res = await keyOf('not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('is 409 ENTRY_REFUSED USED, with usedAt, for a used ticket', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const admitted = await (
      await agent(ctx)
    )
      .post(`/events/${eventId}/entry/admit`)
      .send({ ticketId: tickets[0].id, wholeOrder: false })
      .expect(200);
    const res = await keyOf(tickets[0].id);
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'ENTRY_REFUSED',
      message: 'This ticket was already used.',
      details: { reason: 'USED', usedAt: admitted.body.admitted[0].usedAt },
    });
  });

  it("is 409 ENTRY_REFUSED VOID for a cancelled event's ticket", async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    const res = await keyOf(tickets[0].id);
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'ENTRY_REFUSED',
      message: 'This ticket was cancelled and refunded.',
      details: { reason: 'VOID' },
    });
  });

  it('gives a key for a ticket bought before 017, with no name', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1, holderName: null });
    expect((await keyOf(tickets[0].id)).status).toBe(200);
  });

  it("doesn't depend on the entry window: 30 days away and ended both get a key (FR-005)", async () => {
    const later = await eventAroundNow(ctx, venueId, {
      startsInSeconds: 30 * 86_400,
      lastsSeconds: 10_800,
      name: 'Next Month',
    });
    const ended = await eventAroundNow(ctx, venueId, {
      startsInSeconds: -7_200,
      lastsSeconds: 3_600,
      name: 'Last Night',
    });
    for (const id of [later, ended]) {
      const { tickets } = await orderWithTickets(ctx, id, { quantity: 1 });
      expect((await keyOf(tickets[0].id)).status).toBe(200);
    }
  });
});
