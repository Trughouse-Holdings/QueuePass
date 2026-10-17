import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { customer, event, venue } from '../setup/fixtures';
import { PNG, upload } from '../setup/images';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';

/**
 * Spec 014 FR-005, FR-009, SC-001 (research R2): simultaneous uploads never give an event more
 * than 5 images, and positions stay 1 to n, because every image write runs under the event lock.
 */
describe('Event images under concurrent requests', () => {
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
    eventId = await event(ctx, await venue(ctx), { capacity: 100 });
  });

  const positions = async () =>
    (
      await ctx.prisma.eventImage.findMany({
        where: { eventId },
        select: { position: true },
        orderBy: { position: 'asc' },
      })
    ).map((r) => r.position);

  /** No pool or transaction timeout may hide behind a miscount: assert no 5xx first. */
  const noServerErrors = (results: Response[]) =>
    expect(
      results.filter((r) => r.status >= 500).map((r) => `${r.status} ${JSON.stringify(r.body)}`),
    ).toEqual([]);

  const uploads = (n: number) =>
    Promise.all(Array.from({ length: n }, () => upload(ctx, eventId, PNG)));

  it('lets exactly 2 of 10 simultaneous uploads through to an event with 3 images', async () => {
    for (let i = 0; i < 3; i++) await upload(ctx, eventId, PNG).expect(201);
    const results = await uploads(10);
    noServerErrors(results);
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused).toHaveLength(8);
    for (const r of refused) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('IMAGE_LIMIT_REACHED');
    }
    expect(await positions()).toEqual([1, 2, 3, 4, 5]);
  });

  it('lets exactly 5 of 10 simultaneous uploads through to an empty event', async () => {
    const results = await uploads(10);
    noServerErrors(results);
    expect(results.map((r) => r.status).sort()).toEqual([
      ...Array(5).fill(201),
      ...Array(5).fill(409),
    ]);
    expect(await positions()).toEqual([1, 2, 3, 4, 5]);
  });

  it('serves 5 uploads and 5 orders for the same event at once, with no deadlock', async () => {
    const buyer = await customer(ctx, 1);
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => upload(ctx, eventId, PNG)),
      ...Array.from({ length: 5 }, () =>
        buyer.post(`/events/${eventId}/orders`).send({ quantity: 1, requestId: randomUUID() }),
      ),
    ]);
    noServerErrors(results);
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await positions()).toEqual([1, 2, 3, 4, 5]);
  });
});
