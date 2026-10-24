import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, venue } from '../setup/fixtures';
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
        buyer
          .post(`/events/${eventId}/orders`)
          .send({ holderName: HOLDER, quantity: 1, requestId: randomUUID() }),
      ),
    ]);
    noServerErrors(results);
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await positions()).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps positions 1 to n under 20 simultaneous uploads, deletes, and reorders (FR-009)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await upload(ctx, eventId, PNG).expect(201)).body.id);
    // Each reorder is built from the order read before sending, as the Admin app does.
    const before = (await asAdmin(ctx).get(`/events/${eventId}`).expect(200)).body.images.map(
      (i: { id: string }) => i.id,
    ) as string[];
    const requests = Array.from({ length: 20 }, (_, n) => {
      switch (n % 4) {
        case 0:
          return upload(ctx, eventId, PNG);
        case 1:
          return asAdmin(ctx).delete(`/events/${eventId}/images/${ids[(n >> 2) % ids.length]}`);
        case 2:
          return asAdmin(ctx)
            .put(`/events/${eventId}/images/order`)
            .send({ imageIds: [...before].reverse() });
        default:
          return asAdmin(ctx)
            .put(`/events/${eventId}/images/order`)
            .send({ imageIds: [...before.slice(1), before[0]] });
      }
    });
    const results = await Promise.all(requests);
    noServerErrors(results);
    for (const r of results.filter((x) => x.status >= 400)) {
      expect(['404', '409 IMAGE_LIMIT_REACHED', '409 IMAGES_CHANGED']).toContain(
        r.status === 404 ? '404' : `${r.status} ${r.body.error?.code}`,
      );
    }
    // The first delete of each existing image to take the lock removes it.
    expect(results.filter((r) => r.status === 204).length).toBeGreaterThanOrEqual(1);
    const after = await positions();
    expect(after.length).toBeLessThanOrEqual(5);
    expect(after).toEqual(Array.from({ length: after.length }, (_, i) => i + 1));
  });
});
