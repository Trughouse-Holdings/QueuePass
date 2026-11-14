import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { rateLimitMessage } from '@queuepass/shared';
import { OrdersService } from '../../src/orders/orders.service';
import { anon, as } from '../setup/authed-request';
import { HOLDER, event, seatedEvent, venue } from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { subFor, tokenFor } from '../setup/tokens';

/**
 * Spec 026 US1 (FR-001 to FR-003, FR-007 to FR-010, FR-015, FR-019; SC-001 to SC-003, SC-005;
 * research R1, R2, R4, R10): buy attempts over an account's allowance are refused with
 * `429 RATE_LIMITED` before anything else, with the default limits (10 a minute, 3 in 5 seconds).
 *
 * The counts live in the app's memory and are shared by every case in this file, so each case
 * signs in as customers of its own (`rl-buy-<case>`), never `customer1`. Time moves only with
 * `ctx.attemptClock.advance(ms)`.
 */
describe('Buy attempts over the allowance', () => {
  let ctx: TestContext;
  let venueId: string;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ attemptLimits: 'defaults' });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx);
    eventId = await event(ctx, venueId, { capacity: 1000 });
  });
  afterEach(() => jest.restoreAllMocks());

  const customerToken = (name: string) =>
    tokenFor({ username: `rl-buy-${name}`, roles: ['customer'] });
  const orderBody = (requestId = randomUUID()) => ({ holderName: HOLDER, quantity: 1, requestId });
  const buy = async (token: string, body: object = orderBody()) =>
    as(ctx, token).post(`/events/${eventId}/orders`).send(body);
  const isLimited = (r: Response): boolean => r.status === 429;

  /** FR-008: the code, the message, the details, and `Retry-After`, all saying the same N. */
  function expectRefusal(r: Response, action: 'BUY' | 'HOLD', seconds?: number): number {
    expect(r.status).toBe(429);
    const n = r.body.error.details.retryAfterSeconds as number;
    expect(r.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: rateLimitMessage(n),
        details: { action, retryAfterSeconds: n },
      },
    });
    expect(r.headers['retry-after']).toBe(String(n));
    if (seconds !== undefined) expect(n).toBe(seconds);
    return n;
  }

  it('handles exactly 3 of 20 simultaneous orders from one account and refuses 17 (SC-001)', async () => {
    const token = await customerToken('burst');
    const warn = jest.spyOn(Logger.prototype, 'warn');

    const results = await Promise.all(Array.from({ length: 20 }, () => buy(token)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    const refused = results.filter(isLimited);
    expect(refused).toHaveLength(17);
    for (const r of refused) {
      const n = expectRefusal(r, 'BUY');
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(await ctx.prisma.order.count()).toBe(3);
    expect(await ctx.prisma.ticket.count()).toBe(3);

    // FR-019: one line for the account going over, naming the account, not its name or token.
    const lines = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith('Attempt'));
    expect(lines).toEqual([
      `Attempt limit: customer ${subFor('rl-buy-burst')} over the BUY allowance (3 in 5 seconds); try again in 5 s.`,
    ]);
    expect(lines[0]).not.toContain('rl-buy-burst');
    expect(lines[0]).not.toContain(token);
  });

  it('lets another account buy while one sends 200, and refused attempts never reach the order code (SC-005)', async () => {
    const flood = await customerToken('flood');
    const other = await customerToken('other');
    const create = jest.spyOn(OrdersService.prototype, 'create');

    const [floodResults, otherResult] = await Promise.all([
      Promise.all(Array.from({ length: 200 }, () => buy(flood))),
      buy(other),
    ]);

    expect(otherResult.status).toBe(201);
    const handled = floodResults.filter((r) => !isLimited(r));
    expect(handled).toHaveLength(3);
    expect(floodResults.filter(isLimited)).toHaveLength(197);
    // Exactly one call per answer that was not refused for the limit: 3 + 1.
    expect(create).toHaveBeenCalledTimes(4);
  });

  it('counts an attempt for exactly 5 seconds on the attempt clock (FR-002, SC-003)', async () => {
    const token = await customerToken('boundary');
    for (let i = 0; i < 3; i++) expect((await buy(token)).status).toBe(201);

    expectRefusal(await buy(token), 'BUY', 5);
    ctx.attemptClock.advance(4_999);
    expectRefusal(await buy(token), 'BUY', 1);
    ctx.attemptClock.advance(1);
    expect((await buy(token)).status).toBe(201);
  });

  it('allows 10 in a minute and tells the wait to the oldest being a minute old (FR-002)', async () => {
    const token = await customerToken('minute');
    for (let i = 0; i < 10; i++) {
      expect((await buy(token)).status).toBe(201);
      if (i % 3 === 2) ctx.attemptClock.advance(5_000);
    }
    // The 10 were at 0, 0, 0, 5, 5, 5, 10, 10, 10, 15 s; it is now 15 s.
    expectRefusal(await buy(token), 'BUY', 45);
    ctx.attemptClock.advance(44_999);
    expectRefusal(await buy(token), 'BUY', 1);
    ctx.attemptClock.advance(1);
    expect((await buy(token)).status).toBe(201);
  });

  it('refuses for sign-in and role first, without counting either (FR-003, FR-009)', async () => {
    const name = 'rl-buy-order';
    const expired = await tokenFor({ username: name, roles: ['customer'], expiresIn: -60 });
    const admin = await tokenFor({ username: name, roles: ['queuepass-admin'] });
    for (let i = 0; i < 5; i++) {
      expect((await anon(ctx).post(`/events/${eventId}/orders`).send(orderBody())).status).toBe(
        401,
      );
      expect((await buy(expired)).status).toBe(401);
      expect((await buy(admin)).status).toBe(403);
    }

    const token = await tokenFor({ username: name, roles: ['customer'] });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await buy(token));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 429]);
  });

  it('counts malformed attempts and attempts for an unknown event (FR-003)', async () => {
    const token = await customerToken('malformed');
    expect((await buy(token, {})).status).toBe(400);
    expect((await buy(token, { ...orderBody(), quantity: 0 })).status).toBe(400);
    expect(
      (await as(ctx, token).post(`/events/${randomUUID()}/orders`).send(orderBody())).status,
    ).toBe(404);
    expectRefusal(await buy(token), 'BUY', 5);
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('counts a repeated requestId, which still returns the earlier order (FR-003, FR-020)', async () => {
    const token = await customerToken('repeat');
    const first = orderBody();
    expect((await buy(token, first)).status).toBe(201);
    expect((await buy(token)).status).toBe(201);
    const repeat = await buy(token, first);
    expect(repeat.status).toBe(200);
    expectRefusal(await buy(token, first), 'BUY', 5);
    expectRefusal(await buy(token), 'BUY', 5);
    expect(await ctx.prisma.order.count()).toBe(2);
  });

  it("leaves the account's held seats and their end time unchanged (FR-007, SC-002)", async () => {
    const hall = await venue(ctx, 'Seat Hall');
    // Spec 038: a seated event on a layout made from section lines, one level at 45.00.
    const { eventId: seated, layout } = await seatedEvent(ctx, hall, {
      sections: [{ name: 'A', rows: 1, seatsPerRow: 10 }],
    });
    const sectionId = layout.sections.A;
    const token = await customerToken('held');
    const client = as(ctx, token);
    const seats = [1, 2].map((seat) => ({ sectionId, row: 1, seat }));
    expect((await client.post(`/events/${seated}/reservation`).send({ seats })).status).toBe(201);
    // secondsLeft counts down by the database's clock; the seats and the end time must not change.
    const held = async () =>
      ((await client.get('/me/reservations').expect(200)).body as object[]).map(
        ({ secondsLeft: _s, ...r }: { secondsLeft?: number }) => r,
      );
    const before = await held();
    expect(before).toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      expect((await client.post(`/events/${seated}/orders`).send({})).status).toBe(400);
    }
    const refused = await client
      .post(`/events/${seated}/orders`)
      .send({ ...orderBody(), quantity: 2, seats });
    expectRefusal(refused, 'BUY', 5);

    expect(await held()).toEqual(before);
    expect(await ctx.prisma.order.count()).toBe(0);
    expect(await ctx.prisma.seatHold.count({ where: { releasedAt: null } })).toBe(2);
  });
});
