import { randomUUID } from 'node:crypto';
import { windowAt as liveWindowAt } from '@queuepass/shared';
import { asAdmin } from '../setup/authed-request';
import { agent, eventAroundNow, liveCodeFor, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 017 US1 (FR-008, FR-010): lookupEntryTicket, contract-checked. Window and refusal states
 * beyond ADMITTABLE/USED are entry.window.e2e-spec.ts's job (research R5).
 */
describe('lookupEntryTicket', () => {
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
    // Inside the entry window: started being open 1 hour ago, lasts 3 hours (research R5).
    eventId = await eventAroundNow(ctx, venueId, { startsInSeconds: 3600, lastsSeconds: 10800 });
  });

  const lookup = async (code: string, event = eventId) =>
    (await agent(ctx)).post(`/events/${event}/entry/lookup`).send({ code });

  it('returns every EntryTicket field for an admittable ticket', async () => {
    const { orderId, tickets } = await orderWithTickets(ctx, eventId, {
      quantity: 1,
      holderName: 'Jordan Lee',
    });
    const res = await lookup(tickets[0].code);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ticketId: tickets[0].id,
      code: tickets[0].code,
      orderId,
      state: 'ADMITTABLE',
      event: {
        id: eventId,
        name: 'Around Now',
        startsAt: expect.any(String),
        endsAt: expect.any(String),
      },
      tierName: null,
      seat: null,
      holderName: 'Jordan Lee',
      usedAt: null,
      entryOpensAt: expect.any(String),
      unusedOnOrder: 1,
      // Spec 018 FR-011: a typed or printed code always needs the ID check.
      verifiedBy: 'TICKET_CODE',
    });
    // FR-019: entry opens exactly 2 hours before the start.
    expect(new Date(res.body.entryOpensAt).getTime()).toBe(
      new Date(res.body.event.startsAt).getTime() - 2 * 3600 * 1000,
    );
  });

  it('finds the code in lower case, with spaces, and with dashes (FR-008)', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const code = tickets[0].code;
    const spaced = `${code.slice(0, 4)} ${code.slice(4, 8)} ${code.slice(8)}`;
    const dashed = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    for (const typed of [code.toLowerCase(), spaced, dashed]) {
      const res = await lookup(typed);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(code);
    }
  });

  it('returns the seat of a seated ticket, and the tier name of a tiered one', async () => {
    // Seat labels live on the ticket row (spec 007); set them directly, like the rest of the row.
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    await ctx.prisma.ticket.update({
      where: { id: tickets[0].id },
      data: { seatSection: 'A', seatRow: 2, seatNumber: 7 },
    });
    const res = await lookup(tickets[0].code);
    expect(res.status).toBe(200);
    expect(res.body.seat).toEqual({ section: 'A', row: 2, seat: 7 });

    const tier = await ctx.prisma.ticketTier.create({
      data: { eventId, name: 'VIP', price: '120.00', quantity: 10 },
    });
    await ctx.prisma.ticket.update({
      where: { id: tickets[0].id },
      data: { tierId: tier.id },
    });
    const tiered = await lookup(tickets[0].code);
    expect(tiered.body.tierName).toBe('VIP');
  });

  it('counts unused tickets of the order: 4 fresh, 3 after one is admitted', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 4 });
    expect((await lookup(tickets[0].code)).body.unusedOnOrder).toBe(4);
    await (
      await agent(ctx)
    )
      .post(`/events/${eventId}/entry/admit`)
      .send({ ticketId: tickets[1].id, wholeOrder: false })
      .expect(200);
    expect((await lookup(tickets[0].code)).body.unusedOnOrder).toBe(3);
  });

  it('returns holderName null for an order with no name (FR-005)', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1, holderName: null });
    const res = await lookup(tickets[0].code);
    expect(res.status).toBe(200);
    expect(res.body.holderName).toBeNull();
  });

  it('records nothing: checkedInAt is unchanged by a lookup', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    await lookup(tickets[0].code);
    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(row.checkedInAt).toBeNull();
  });

  it.each(['ZZZZZZZZZZZZ', 'ABC', 'IIIIIIIIIIII'])(
    'is 404 TICKET_NOT_FOUND for %j (unknown, too short, outside the alphabet)',
    async (code) => {
      const res = await lookup(code);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
    },
  );

  it('is 404 NOT_FOUND for an unknown event', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const res = await lookup(tickets[0].code, randomUUID());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('is 400 for an empty code', async () => {
    const res = await lookup('');
    expect(res.status).toBe(400);
  });

  describe('spec 018: verifiedBy and one ticket for every code (FR-014)', () => {
    afterEach(() => ctx.clock.useRealTime());

    const admit = async (ticketId: string) =>
      (await agent(ctx))
        .post(`/events/${eventId}/entry/admit`)
        .send({ ticketId, wholeOrder: false })
        .expect(200);

    it('answers TICKET_CODE for a typed code in any case, with spaces or dashes', async () => {
      const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
      const code = tickets[0].code;
      for (const typed of [
        code,
        code.toLowerCase(),
        `${code.slice(0, 6)} ${code.slice(6)}`,
        `${code.slice(0, 6)}-${code.slice(6)}`,
      ]) {
        const res = await lookup(typed);
        expect(res.status).toBe(200);
        expect(res.body.verifiedBy).toBe('TICKET_CODE');
      }
    });

    it('a ticket admitted by its live code is USED by its typed code, and the other way around', async () => {
      const w = liveWindowAt(Date.now());
      ctx.clock.set(w * 30_000 + 15_000);
      const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 2 });
      const [a, b] = tickets;

      const live = await lookup(await liveCodeFor(ctx, a.id, w));
      expect(live.body).toMatchObject({ state: 'ADMITTABLE', verifiedBy: 'LIVE_CODE' });
      await admit(a.id);
      expect((await lookup(a.code)).body).toMatchObject({
        state: 'USED',
        verifiedBy: 'TICKET_CODE',
      });

      expect((await lookup(b.code)).body.state).toBe('ADMITTABLE');
      await admit(b.id);
      expect((await lookup(await liveCodeFor(ctx, b.id, w))).body).toMatchObject({
        state: 'USED',
        verifiedBy: 'LIVE_CODE',
      });
    });
  });

  it('shadows no existing route: the admin attendee list still answers 200', async () => {
    // Sanity: the entry module must not shadow existing routes.
    await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);
  });
});
