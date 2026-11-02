import { windowAt as liveWindowAt } from '@queuepass/shared';
import { agent, eventAroundNow, liveCodeFor, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 018 SC-001 (FR-008, research R3): a live code is accepted from 5 seconds before its window
 * until 5 seconds after, on the Backend's clock, to the millisecond, and refused just outside.
 * `liveWindowAt` is the shared module's `windowAt`; fixtures.ts has its own `windowAt` for event
 * times.
 */
describe('Live code window boundaries', () => {
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
  afterEach(() => ctx.clock.useRealTime());

  const lookupAt = async (code: string, ms: number) => {
    ctx.clock.set(ms);
    return (await agent(ctx)).post(`/events/${eventId}/entry/lookup`).send({ code });
  };

  it('accepts at both inner edges and refuses at both outer edges, for 3 windows in a row', async () => {
    const first = liveWindowAt(Date.now());
    for (const w of [first, first + 1, first + 2]) {
      const code = await liveCodeFor(ctx, ticketId, w);
      const start = w * 30_000;
      for (const ms of [start - 5000, (w + 1) * 30_000 + 4999]) {
        const res = await lookupAt(code, ms);
        expect(res.status).toBe(200);
        expect(res.body.verifiedBy).toBe('LIVE_CODE');
      }
      for (const ms of [start - 5001, (w + 1) * 30_000 + 5000]) {
        const res = await lookupAt(code, ms);
        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          error: { code: 'LIVE_CODE_EXPIRED', message: 'This live code has expired.' },
        });
      }
    }
  });

  it('admits a ticket looked up at the last accepted instant after the grace has passed', async () => {
    const w = liveWindowAt(Date.now());
    const code = await liveCodeFor(ctx, ticketId, w);
    const last = (w + 1) * 30_000 + 4999;
    expect((await lookupAt(code, last)).status).toBe(200);
    ctx.clock.set(last + 60_000);
    const res = await (
      await agent(ctx)
    )
      .post(`/events/${eventId}/entry/admit`)
      .send({ ticketId, wholeOrder: false });
    expect(res.status).toBe(200);
    expect(res.body.admitted).toHaveLength(1);
  });

  // Spec 025 FR-011, FR-012 (research R7): a live code meets the same entry window as a typed
  // code, `[doorsOpenAt - 1 hour, endsAt)` on the database's clock, here with doors 3 hours
  // before the start, so entry opens 4 hours before it.
  it.each([
    ['30 seconds before entry opens: NOT_OPEN', 4 * 3600 + 30, 'NOT_OPEN'],
    ['30 seconds after entry opens: ADMITTABLE', 4 * 3600 - 30, 'ADMITTABLE'],
  ])('doors 180 minutes before the start, %s', async (_label, startsInSeconds, state) => {
    const doorsEvent = await eventAroundNow(ctx, await venue(ctx, 'Doors Hall'), {
      startsInSeconds,
      lastsSeconds: 3600,
      doorsBeforeStartSeconds: 3 * 3600,
    });
    const ticket = (await orderWithTickets(ctx, doorsEvent, { quantity: 1 })).tickets[0].id;
    const code = await liveCodeFor(ctx, ticket, liveWindowAt(Date.now()));
    const res = await (await agent(ctx)).post(`/events/${doorsEvent}/entry/lookup`).send({ code });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe(state);
    expect(res.body.verifiedBy).toBe('LIVE_CODE');
    const stored = await ctx.prisma.event.findUniqueOrThrow({ where: { id: doorsEvent } });
    expect(new Date(res.body.entryOpensAt).getTime()).toBe(
      stored.doorsOpenAt.getTime() - 3600 * 1000,
    );
  });
});
