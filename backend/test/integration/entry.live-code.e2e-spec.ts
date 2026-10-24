import { windowAt as liveWindowAt } from '@queuepass/shared';
import { asAdmin } from '../setup/authed-request';
import { agent, eventAroundNow, liveCodeFor, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 018 US1 (FR-011, research R4): lookupEntryTicket with a current live code, contract-checked.
 * The Backend's clock sits in the middle of a window; the entry window stays on the database's
 * clock, as in 017.
 */
describe('lookupEntryTicket with a live code', () => {
  let ctx: TestContext;
  let venueId: string;
  let eventId: string;
  let w: number;

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
    w = liveWindowAt(Date.now());
    ctx.clock.set(w * 30_000 + 15_000);
  });
  afterEach(() => ctx.clock.useRealTime());

  const lookup = async (code: string, gate = eventId) =>
    (await agent(ctx)).post(`/events/${gate}/entry/lookup`).send({ code });
  const admit = async (ticketId: string, wholeOrder = false) =>
    (await agent(ctx)).post(`/events/${eventId}/entry/admit`).send({ ticketId, wholeOrder });

  it('answers every EntryTicket field of 017, verified by live code', async () => {
    const { orderId, tickets } = await orderWithTickets(ctx, eventId, {
      quantity: 1,
      holderName: 'Jordan Lee',
    });
    const res = await lookup(await liveCodeFor(ctx, tickets[0].id, w));
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
      verifiedBy: 'LIVE_CODE',
    });
  });

  it('accepts the code in lower case', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const res = await lookup((await liveCodeFor(ctx, tickets[0].id, w)).toLowerCase());
    expect(res.status).toBe(200);
    expect(res.body.verifiedBy).toBe('LIVE_CODE');
  });

  it('records nothing, then admits through the looked-up ticket id', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    await lookup(await liveCodeFor(ctx, tickets[0].id, w)).then((r) => expect(r.status).toBe(200));
    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(row.checkedInAt).toBeNull();
    const res = await admit(tickets[0].id);
    expect(res.status).toBe(200);
    expect(res.body.admitted).toHaveLength(1);
  });

  it('admits all 3 of an order with wholeOrder after one live code (clarified 2026-10-23)', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 3 });
    const looked = await lookup(await liveCodeFor(ctx, tickets[1].id, w));
    expect(looked.body).toMatchObject({ unusedOnOrder: 3, verifiedBy: 'LIVE_CODE' });
    const res = await admit(looked.body.ticketId, true);
    expect(res.status).toBe(200);
    expect(res.body.admitted).toHaveLength(3);
  });

  it('gives a used ticket USED with usedAt', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const admitted = await admit(tickets[0].id);
    const res = await lookup(await liveCodeFor(ctx, tickets[0].id, w));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: 'USED',
      usedAt: admitted.body.admitted[0].usedAt,
      verifiedBy: 'LIVE_CODE',
    });
  });

  it("gives a cancelled event's ticket VOID, at another gate", async () => {
    const cancelled = await eventAroundNow(ctx, await venue(ctx, 'Other Hall'), {
      startsInSeconds: 3600,
      lastsSeconds: 10800,
      name: 'Called Off',
    });
    const { tickets } = await orderWithTickets(ctx, cancelled, { quantity: 1 });
    await asAdmin(ctx).post(`/events/${cancelled}/cancel`).expect(200);
    const res = await lookup(await liveCodeFor(ctx, tickets[0].id, w));
    expect(res.body).toMatchObject({ state: 'VOID', verifiedBy: 'LIVE_CODE' });
  });

  it("gives another event's ticket OTHER_EVENT, naming its event", async () => {
    const other = await eventAroundNow(ctx, await venue(ctx, 'Other Hall'), {
      startsInSeconds: 3600,
      lastsSeconds: 10800,
      name: 'Elsewhere',
    });
    const { tickets } = await orderWithTickets(ctx, other, { quantity: 1 });
    const res = await lookup(await liveCodeFor(ctx, tickets[0].id, w));
    expect(res.body).toMatchObject({
      state: 'OTHER_EVENT',
      event: { id: other, name: 'Elsewhere' },
      verifiedBy: 'LIVE_CODE',
    });
  });

  it('gives NOT_OPEN before the entry window and ENDED after the event', async () => {
    const later = await eventAroundNow(ctx, venueId, {
      startsInSeconds: 3 * 3600,
      lastsSeconds: 10800,
      name: 'Later',
    });
    const ended = await eventAroundNow(ctx, venueId, {
      startsInSeconds: -7200,
      lastsSeconds: 3600,
      name: 'Over',
    });
    const notOpen = (await orderWithTickets(ctx, later, { quantity: 1 })).tickets[0].id;
    const over = (await orderWithTickets(ctx, ended, { quantity: 1 })).tickets[0].id;
    const a = await lookup(await liveCodeFor(ctx, notOpen, w), later);
    const b = await lookup(await liveCodeFor(ctx, over, w), ended);
    expect(a.body).toMatchObject({ state: 'NOT_OPEN', verifiedBy: 'LIVE_CODE' });
    expect(b.body).toMatchObject({ state: 'ENDED', verifiedBy: 'LIVE_CODE' });
  });

  it('works for a ticket bought before 017, with holderName null', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1, holderName: null });
    const res = await lookup(await liveCodeFor(ctx, tickets[0].id, w));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: 'ADMITTABLE',
      holderName: null,
      verifiedBy: 'LIVE_CODE',
    });
  });
});
