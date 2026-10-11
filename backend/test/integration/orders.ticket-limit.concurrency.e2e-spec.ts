import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { customer, event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor } from '../setup/tokens';

/**
 * Spec 016 US2 (FR-004, FR-007, SC-001; research R2): simultaneous orders from one customer never
 * leave them above the limit, because every order for an event runs under its row lock.
 */
describe('Per-customer ticket limit under concurrent orders', () => {
  let ctx: TestContext;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const venueId = await venue(ctx);
    eventId = await event(ctx, venueId, { capacity: 100, maxTicketsPerCustomer: 8 });
  });

  const held = () =>
    ctx.prisma.ticket.count({
      where: { eventId, status: 'VALID', order: { customerSub: subFor('customer1') } },
    });

  /** Fires every body at once from the same customer. */
  const fire = async (bodies: object[]): Promise<Response[]> => {
    const buyer = await customer(ctx, 1);
    const results = await Promise.all(
      bodies.map((b) => buyer.post(`/events/${eventId}/orders`).send(b)),
    );
    // A pool or transaction timeout would otherwise show up as a confusing miscount.
    const failed = results.filter((r) => r.status >= 500);
    expect(failed.map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
    return results;
  };
  const statuses = (results: Response[]) => results.map((r) => r.status);

  it('lets exactly 8 of 50 simultaneous one-ticket orders through (SC-001)', async () => {
    const results = await fire(
      Array.from({ length: 50 }, () => ({ quantity: 1, requestId: randomUUID() })),
    );

    expect(statuses(results).filter((s) => s === 201)).toHaveLength(8);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused).toHaveLength(42);
    for (const r of refused) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('TICKET_LIMIT_REACHED');
    }
    expect(await held()).toBe(8);
  });

  it('lets exactly one of two simultaneous orders of 6 through', async () => {
    const results = await fire([
      { quantity: 6, requestId: randomUUID() },
      { quantity: 6, requestId: randomUUID() },
    ]);

    expect(statuses(results).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error).toMatchObject({
      code: 'TICKET_LIMIT_REACHED',
      details: { limit: 8, held: 6, remaining: 2, requested: 6 },
    });
    expect(await held()).toBe(6);
  });

  it('counts 10 simultaneous repeats of one confirmation once (FR-007)', async () => {
    const body = { quantity: 3, requestId: randomUUID() };
    const results = await fire(Array.from({ length: 10 }, () => body));

    expect(statuses(results).filter((s) => s === 201)).toHaveLength(1);
    expect(statuses(results).filter((s) => s === 200)).toHaveLength(9);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await held()).toBe(3);
  });
});
