import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { atInstant, customer, endEventAt, event, HOLDER, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 034 FR-001, FR-002, FR-005, SC-001, SC-002 (research R1, R8, R11): sales close when an
 * event ends, not when it starts, under the event lock. The order check reads the Backend's
 * process clock, the same as this test's, so every instant here is the test's own `new Date()`,
 * never the database's `now()`.
 */
describe('Sales close at the end time', () => {
  let ctx: TestContext;
  let venueId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx);
  });

  const order = async (eventId: string, body: object) =>
    (await customer(ctx)).post(`/events/${eventId}/orders`).send({ holderName: HOLDER, ...body });
  const code = (res: Response): string => res.body.error?.code;

  /** A window starting `startMs` from now and ending `endMs` from now (negative: in the past). */
  const window = (startMs: number, endMs: number) => {
    const now = Date.now();
    return { startsAt: atInstant(now + startMs), endsAt: atInstant(now + endMs) };
  };
  const HOUR = 3_600_000;

  it('accepts an order for an event that started a minute ago and ends in 3 hours', async () => {
    const eventId = await event(ctx, venueId, window(-60_000, 3 * HOUR));

    const res = await order(eventId, { quantity: 1 });

    expect(res.status).toBe(201);
    expect(await ctx.prisma.order.count()).toBe(1);
  });

  it('accepts an order just before the end (the event ends in 10 seconds)', async () => {
    const eventId = await event(ctx, venueId, window(-3 * HOUR, 10_000));

    expect((await order(eventId, { quantity: 1 })).status).toBe(201);
  });

  it('refuses an order once the event has ended, and records nothing', async () => {
    const eventId = await event(ctx, venueId, window(-60_000, HOUR));
    await endEventAt(ctx, eventId, new Date(Date.now() - 1_000));

    const res = await order(eventId, { quantity: 1 });

    expect(res.status).toBe(409);
    expect(code(res)).toBe('SALES_CLOSED');
    expect(res.body.error.message).toBe('Sales for Season Opener closed when it ended.');
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('refuses an order at the end just reached (half-open)', async () => {
    const eventId = await event(ctx, venueId, window(-60_000, HOUR));
    // The request arrives at, or a few milliseconds after, this instant (research R1, R11).
    await endEventAt(ctx, eventId, new Date());

    const res = await order(eventId, { quantity: 1 });

    expect(res.status).toBe(409);
    expect(code(res)).toBe('SALES_CLOSED');
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('says cancelled, not sales closed, for a cancelled event in progress', async () => {
    const eventId = await event(ctx, venueId, window(-60_000, 3 * HOUR));
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const res = await order(eventId, { quantity: 1 });

    expect(res.status).toBe(409);
    expect(code(res)).toBe('EVENT_CANCELLED');
  });

  it('still returns an earlier order for a repeated requestId after the event ends', async () => {
    const eventId = await event(ctx, venueId, window(-60_000, HOUR));
    const body = { quantity: 1, requestId: randomUUID() };
    const first = await order(eventId, body);
    expect(first.status).toBe(201);
    await endEventAt(ctx, eventId, new Date(Date.now() - 1_000));

    const repeat = await order(eventId, body);

    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(first.body.id);
  });
});
