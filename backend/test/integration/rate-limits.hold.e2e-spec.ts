import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { rateLimitMessage } from '@queuepass/shared';
import { SeatEventsService } from '../../src/seating/seat-events.service';
import { as, asAdmin } from '../setup/authed-request';
import { HOLDER, event, venue } from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 026 US1 (FR-001, FR-002, FR-004, FR-007, FR-010; SC-001, SC-002; research R1, R7, R10):
 * seat-hold attempts have their own allowance, separate from buying; releases are never limited.
 * One customer of its own per case (`rl-hold-<case>`), as the counts outlive each case.
 */
describe('Seat-hold attempts over the allowance', () => {
  let ctx: TestContext;
  let eventId: string;
  let gaEventId: string;
  let sectionId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ attemptLimits: 'defaults' });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const venueId = await venue(ctx, 'Seat Hall');
    const layout = await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({ sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }] })
      .expect(200);
    sectionId = layout.body.sections[0].id;
    eventId = await event(ctx, venueId, { capacity: 30 });
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
    gaEventId = await event(ctx, await venue(ctx, 'Open Hall'), { capacity: 100 });
  });
  afterEach(() => jest.restoreAllMocks());

  const customer = async (name: string) =>
    as(ctx, await tokenFor({ username: `rl-hold-${name}`, roles: ['customer'] }));
  type Client = Awaited<ReturnType<typeof customer>>;
  const seat = (n: number) => ({ sectionId, row: Math.ceil(n / 10), seat: ((n - 1) % 10) + 1 });
  const hold = (c: Client, ...seats: number[]) =>
    c.post(`/events/${eventId}/reservation`).send({ seats: seats.map(seat) });
  const buy = (c: Client) =>
    c
      .post(`/events/${gaEventId}/orders`)
      .send({ holderName: HOLDER, quantity: 1, requestId: randomUUID() });
  const expectHoldRefusal = (r: Response, seconds?: number): void => {
    expect(r.status).toBe(429);
    const n = r.body.error.details.retryAfterSeconds as number;
    expect(r.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: rateLimitMessage(n),
      details: { action: 'HOLD', retryAfterSeconds: n },
    });
    expect(r.headers['retry-after']).toBe(String(n));
    if (seconds !== undefined) expect(n).toBe(seconds);
  };
  /** The account's reservations without `secondsLeft`, which counts down by itself. */
  const reservations = async (c: Client) =>
    ((await c.get('/me/reservations').expect(200)).body as { secondsLeft?: number }[]).map(
      ({ secondsLeft: _s, ...r }) => r,
    );

  it('handles exactly 3 of 20 simultaneous holds, each of its own seat, and refuses 17 (SC-001)', async () => {
    const c = await customer('burst');

    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => hold(c, i + 1)));

    const handled = results.flatMap((r, i) => (r.status === 429 ? [] : [{ r, n: i + 1 }]));
    expect(handled).toHaveLength(3);
    const refused = results.filter((r) => r.status === 429);
    expect(refused).toHaveLength(17);
    for (const r of refused) {
      expectHoldRefusal(r);
      expect(r.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(5);
    }
    const heldSeats = handled.filter(({ r }) => r.status === 200 || r.status === 201);
    const [mine] = await reservations(c);
    expect(
      (mine as { seats: { row: number; seat: number }[] }).seats
        .map((s) => `${s.row}-${s.seat}`)
        .sort(),
    ).toEqual(heldSeats.map(({ n }) => `${seat(n).row}-${seat(n).seat}`).sort());
    expect(await ctx.prisma.seatHold.count({ where: { releasedAt: null } })).toBe(heldSeats.length);
  });

  it('keeps the held seats and their end time, and publishes nothing, on a refusal (FR-007, SC-002)', async () => {
    const c = await customer('kept');
    expect((await hold(c, 1, 2)).status).toBe(201);
    // Two more attempts, each refused for its own reason (already in the reservation): counted.
    expect((await hold(c, 1)).status).toBe(400);
    expect((await hold(c, 2)).status).toBe(400);
    const before = await reservations(c);
    const publish = jest.spyOn(SeatEventsService.prototype, 'publish');

    expectHoldRefusal(await hold(c, 3), 5);

    expect(publish).not.toHaveBeenCalled();
    expect(await reservations(c)).toEqual(before);
    expect(await ctx.prisma.seatHold.count({ where: { releasedAt: null } })).toBe(2);
  });

  it('never counts or refuses releases (FR-004)', async () => {
    const c = await customer('release');
    for (const n of [1, 2, 3]) expect([200, 201]).toContain((await hold(c, n)).status);
    expectHoldRefusal(await hold(c, 4), 5);

    const releases: Response[] = [];
    for (const n of [1, 2, 3]) {
      releases.push(
        await c.post(`/events/${eventId}/reservation/release`).send({ seats: [seat(n)] }),
      );
    }
    for (let i = 0; i < 7; i++) {
      releases.push(await c.post(`/events/${eventId}/reservation/release`).send({}));
    }
    for (let i = 0; i < 3; i++) releases.push(await c.post('/me/reservations/release'));

    expect(releases.map((r) => r.status)).toEqual(Array(13).fill(200));
    // The releases left the hold allowance as it was: still waiting out the same 5 seconds.
    expectHoldRefusal(await hold(c, 4), 5);
  });

  it('keeps the buy and hold allowances apart (FR-001)', async () => {
    const buyer = await customer('buy-first');
    for (let i = 0; i < 3; i++) expect((await buy(buyer)).status).toBe(201);
    expect((await buy(buyer)).status).toBe(429);
    expect((await hold(buyer, 5)).status).toBe(201);

    const holder = await customer('hold-first');
    for (const n of [6, 7, 8]) expect([200, 201]).toContain((await hold(holder, n)).status);
    expectHoldRefusal(await hold(holder, 9));
    expect((await buy(holder)).status).toBe(201);
  });
});
