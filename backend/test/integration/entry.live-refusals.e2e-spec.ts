import crypto, { randomBytes, randomUUID } from 'node:crypto';
import { liveCode, windowAt as liveWindowAt } from '@queuepass/shared';
import { agent, eventAroundNow, liveCodeFor, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 018 US2 (FR-011, FR-012, research R4): a code in live-code form that QueuePass didn't make
 * is "not valid", never "expired"; only a genuine old code is "expired". No refusal carries ticket
 * details, and none changes the ticket.
 */
describe('Live code refusals', () => {
  let ctx: TestContext;
  let eventId: string;
  let ticketId: string;
  let otherId: string;
  let w: number;

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
    [ticketId, otherId] = (await orderWithTickets(ctx, eventId, { quantity: 2 })).tickets.map(
      (t) => t.id,
    );
    w = liveWindowAt(Date.now());
    ctx.clock.set(w * 30_000 + 15_000);
  });
  afterEach(() => ctx.clock.useRealTime());

  const lookup = async (code: string) =>
    (await agent(ctx)).post(`/events/${eventId}/entry/lookup`).send({ code });

  const INVALID = {
    error: { code: 'LIVE_CODE_INVALID', message: 'This is not a valid QueuePass code.' },
  };

  const swapLast = (code: string): string => code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A');

  it('refuses every forged or malformed live code as not valid, changing nothing', async () => {
    const good = await liveCodeFor(ctx, ticketId, w);
    const [prefix, hex, , mac] = good.split(':');
    const otherSecret = (
      await ctx.prisma.ticket.findUniqueOrThrow({
        where: { id: otherId },
        select: { entrySecret: true },
      })
    ).entrySecret;
    const forged = [
      swapLast(good),
      // The right MAC for this ticket and window, made with another ticket's secret.
      await liveCode(otherSecret, ticketId, w),
      // Well formed, naming a ticket that doesn't exist.
      await liveCode(new Uint8Array(32), randomUUID(), w),
      'QP1:',
      'QP1:XYZ',
      `${prefix}:${hex}:${w + 1}:${mac}`,
      `${prefix}:${hex}:${w}:${mac.slice(1)}`,
    ];
    for (const code of forged) {
      const res = await lookup(code);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(INVALID);
    }
    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.checkedInAt).toBeNull();
  });

  it('says expired, not used, for an old genuine code of a used ticket (window first)', async () => {
    const old = await liveCodeFor(ctx, ticketId, w - 2);
    await (
      await agent(ctx)
    )
      .post(`/events/${eventId}/entry/admit`)
      .send({ ticketId, wholeOrder: false })
      .expect(200);
    const res = await lookup(old);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'LIVE_CODE_EXPIRED', message: 'This live code has expired.' },
    });
  });

  it('leaves the ticket usable: after an expired code, the current one admits (US2-5)', async () => {
    expect((await lookup(await liveCodeFor(ctx, ticketId, w - 2))).status).toBe(409);
    expect((await lookup(swapLast(await liveCodeFor(ctx, ticketId, w)))).status).toBe(404);
    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.checkedInAt).toBeNull();

    const current = await lookup(await liveCodeFor(ctx, ticketId, w));
    expect(current.body).toMatchObject({ state: 'ADMITTABLE', verifiedBy: 'LIVE_CODE' });
    await (
      await agent(ctx)
    )
      .post(`/events/${eventId}/entry/admit`)
      .send({ ticketId: current.body.ticketId, wholeOrder: false })
      .expect(200);
  });

  it('does the same work for an unknown ticket as for a wrong MAC (FR-011)', async () => {
    // How long a refusal takes mustn't tell a real ticket's id from a guess. Time is too noisy to
    // assert, so this checks that both refusals make a code and compare all of it in constant time.
    const gate = await agent(ctx);
    const wrongMac = swapLast(await liveCodeFor(ctx, ticketId, w));
    const guess = await liveCode(randomBytes(32), randomUUID(), w);
    const sign = jest.spyOn(globalThis.crypto.subtle, 'sign');
    const compare = jest.spyOn(crypto, 'timingSafeEqual');
    const workFor = async (code: string) => {
      sign.mockClear();
      compare.mockClear();
      const res = await gate.post(`/events/${eventId}/entry/lookup`).send({ code });
      expect(res.body).toEqual(INVALID);
      return {
        hmacs: sign.mock.calls.length,
        compared: compare.mock.calls.map(([a, b]) => [a.byteLength, b.byteLength]),
      };
    };
    try {
      const known = await workFor(wrongMac);
      expect(known.hmacs).toBe(1);
      // The whole code, not a slice of it.
      expect(known.compared).toEqual([[wrongMac.length, wrongMac.length]]);
      expect(await workFor(guess)).toEqual(known);
    } finally {
      sign.mockRestore();
      compare.mockRestore();
    }
  });

  it('is 400 for an 81-character code', async () => {
    const res = await lookup(`QP1:${'A'.repeat(77)}`);
    expect(res.status).toBe(400);
  });
});
