import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { HOLDER, customer, event, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 006 FR-005, SC-002 (research R3): one confirmation records at most one order. */
describe('Orders with a requestId', () => {
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

  const order = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, ...body });
  const code = (res: Response): string => res.body.error?.code;

  it('returns the first order, with 200, when the same request is repeated', async () => {
    const eventId = await event(ctx, venueId);
    const body = { quantity: 2, requestId: randomUUID() };

    const first = await order(eventId, body);
    const second = await order(eventId, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await ctx.prisma.order.count()).toBe(1);
    expect(await ctx.prisma.ticket.count()).toBe(2);
  });

  it('records exactly one order for 10 simultaneous identical confirmations', async () => {
    const eventId = await event(ctx, venueId, { capacity: 100 });
    const body = { quantity: 1, requestId: randomUUID() };
    const client = await customer(ctx);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        client.post(`/events/${eventId}/orders`).send({ holderName: HOLDER, ...body }),
      ),
    );

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await ctx.prisma.order.count()).toBe(1);
    expect(await ctx.prisma.ticket.count()).toBe(1);
  });

  it('refuses the same requestId for a different quantity, tier, or event', async () => {
    const eventId = await event(ctx, venueId, { capacity: 100 });
    const vip = await tier(ctx, eventId, 'VIP', '99.00', 20);
    const general = await tier(ctx, eventId, 'General', '10.00', 50);
    const other = await event(ctx, venueId);
    const otherTier = await tier(ctx, other, 'General', '10.00', 50);
    const requestId = randomUUID();
    await order(eventId, { tierId: vip, quantity: 2, requestId }).then((r) =>
      expect(r.status).toBe(201),
    );

    for (const body of [
      { tierId: vip, quantity: 3, requestId },
      { tierId: general, quantity: 2, requestId },
    ]) {
      const res = await order(eventId, body);
      expect(res.status).toBe(409);
      expect(code(res)).toBe('REQUEST_ID_REUSED');
    }
    const elsewhere = await order(other, { tierId: otherTier, quantity: 2, requestId });
    expect(elsewhere.status).toBe(409);
    expect(code(elsewhere)).toBe('REQUEST_ID_REUSED');
    expect(await ctx.prisma.order.count()).toBe(1);
  });

  it('keeps requestIds separate per customer', async () => {
    const eventId = await event(ctx, venueId);
    const body = { quantity: 1, requestId: randomUUID() };

    const mine = await order(eventId, body, 1);
    const theirs = await order(eventId, body, 2);

    expect([mine.status, theirs.status]).toEqual([201, 201]);
    expect(theirs.body.id).not.toBe(mine.body.id);
    expect(theirs.body.customerUsername).toBe('customer2');
  });

  it('still returns the original order after the event sells out', async () => {
    const eventId = await event(ctx, venueId, { capacity: 2 });
    const body = { quantity: 2, requestId: randomUUID() };
    const first = await order(eventId, body);

    const repeat = await order(eventId, body);

    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(first.body.id);
  });

  it('places a new order every time when no requestId is sent', async () => {
    const eventId = await event(ctx, venueId);
    await order(eventId, { quantity: 1 }).then((r) => expect(r.status).toBe(201));
    await order(eventId, { quantity: 1 }).then((r) => expect(r.status).toBe(201));
    expect(await ctx.prisma.order.count()).toBe(2);
  });

  it('refuses a requestId that is not a UUID', async () => {
    const eventId = await event(ctx, venueId);
    const res = await order(eventId, { quantity: 1, requestId: 'twice' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('VALIDATION_FAILED');
  });
});
