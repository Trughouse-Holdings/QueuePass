import { randomUUID } from 'node:crypto';
import { asAdmin } from '../setup/authed-request';
import { event, venue } from '../setup/fixtures';
import { PNG, upload } from '../setup/images';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';

/**
 * Spec 014 US3 (FR-007 to FR-011; research R2, R5, R7): removing and reordering an event's
 * images, through the contract-checking client. Positions stay 1 to n with no gap.
 */
describe('Event images: delete and reorder', () => {
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
    eventId = await event(ctx, await venue(ctx), { name: 'Season Opener' });
  });

  /** Adds `n` images and returns their ids in order. */
  const addImages = async (n: number, forEvent = eventId): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await upload(ctx, forEvent, PNG).expect(201)).body.id);
    return ids;
  };
  const rows = () =>
    ctx.prisma.eventImage.findMany({
      where: { eventId },
      select: { id: true, position: true },
      orderBy: { position: 'asc' },
    });
  const listed = async () => (await asAdmin(ctx).get(`/events/${eventId}`).expect(200)).body.images;
  const remove = (imageId: string, forEvent = eventId) =>
    asAdmin(ctx).delete(`/events/${forEvent}/images/${imageId}`);
  const reorder = (body: object) => asAdmin(ctx).put(`/events/${eventId}/images/order`).send(body);

  describe('delete (FR-007)', () => {
    it('removes image 2 of 4 and closes the gap, keeping the old order', async () => {
      const [a, b, c, d] = await addImages(4);
      const res = await remove(b!).expect(204);
      expect(res.text).toBe('');
      expect(
        (await listed()).map((i: { id: string; position: number }) => [i.id, i.position]),
      ).toEqual([
        [a, 1],
        [c, 2],
        [d, 3],
      ]);
      expect(await rows()).toEqual([
        { id: a, position: 1 },
        { id: c, position: 2 },
        { id: d, position: 3 },
      ]);
      await asAdmin(ctx).get(`/events/${eventId}/images/${b}`).expect(404);
      const again = await remove(b!).expect(404);
      expect(again.body.error.code).toBe('NOT_FOUND');
    });

    it('removes the first and the last image', async () => {
      const [a, b, c] = await addImages(3);
      await remove(a!).expect(204);
      await remove(c!).expect(204);
      expect(await rows()).toEqual([{ id: b, position: 1 }]);
    });

    it('refuses an image of another event, an unknown image, an unknown event, and a malformed id', async () => {
      const [a] = await addImages(1);
      const other = await event(ctx, await venue(ctx, 'Other Hall'), { name: 'Other' });
      const [theirs] = await addImages(1, other);
      await remove(theirs!).expect(404);
      await remove(randomUUID()).expect(404);
      await remove(a!, randomUUID()).expect(404);
      await remove('not-a-uuid').expect(400);
      await remove(a!, 'not-a-uuid').expect(400);
      expect(await rows()).toEqual([{ id: a, position: 1 }]);
      expect(await ctx.prisma.eventImage.count({ where: { eventId: other } })).toBe(1);
    });
  });

  describe('reorder (FR-008)', () => {
    it('sets the order of 4 images to [d, a, b, c]', async () => {
      const [a, b, c, d] = await addImages(4);
      const res = await reorder({ imageIds: [d, a, b, c] }).expect(200);
      expect(res.body.map((i: { id: string; position: number }) => [i.id, i.position])).toEqual([
        [d, 1],
        [a, 2],
        [b, 3],
        [c, 4],
      ]);
      for (const image of res.body) {
        expect(Object.keys(image).sort()).toEqual(['byteSize', 'contentType', 'id', 'position']);
      }
      expect((await listed()).map((i: { id: string }) => i.id)).toEqual([d, a, b, c]);
      expect(await rows()).toEqual([
        { id: d, position: 1 },
        { id: a, position: 2 },
        { id: b, position: 3 },
        { id: c, position: 4 },
      ]);
    });

    it('accepts the order it already has, and a full reversal', async () => {
      const [a, b, c, d, e] = await addImages(5);
      await reorder({ imageIds: [a, b, c, d, e] }).expect(200);
      const res = await reorder({ imageIds: [e, d, c, b, a] }).expect(200);
      expect(res.body.map((i: { id: string }) => i.id)).toEqual([e, d, c, b, a]);
    });

    it('refuses a list that does not name exactly the current images with IMAGES_CHANGED', async () => {
      const [a, b, c] = await addImages(3);
      const other = await event(ctx, await venue(ctx, 'Other Hall'), { name: 'Other' });
      const [theirs] = await addImages(1, other);
      for (const imageIds of [
        [c, a], // one missing
        [c, a, b, randomUUID()], // an extra id
        [c, a, theirs], // another event's image
      ]) {
        const res = await reorder({ imageIds }).expect(409);
        expect(res.body.error.code).toBe('IMAGES_CHANGED');
        expect(res.body.error.message).toBe(
          'The images of Season Opener changed since you loaded them. Check them and try again.',
        );
        expect(res.body.error.details).toEqual({ imageIds: [a, b, c] });
      }
      expect(await rows()).toEqual([
        { id: a, position: 1 },
        { id: b, position: 2 },
        { id: c, position: 3 },
      ]);
    });

    it('refuses a malformed list with 400', async () => {
      const ids = await addImages(3);
      const [a, b] = ids;
      for (const body of [
        { imageIds: [a, a, b] }, // a repeated id
        { imageIds: [a, 'not-a-uuid', b] },
        { imageIds: [...ids, randomUUID(), randomUUID(), randomUUID()] }, // 6 ids
        {}, // no imageIds
        { imageIds: a }, // not a list
        { imageIds: ids, extra: true },
      ]) {
        const res = await reorder(body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect((await rows()).map((r) => r.id)).toEqual(ids);
    });

    it('accepts an empty list for an event with no images', async () => {
      const res = await reorder({ imageIds: [] }).expect(200);
      expect(res.body).toEqual([]);
    });

    it('refuses an unknown event with 404', async () => {
      await asAdmin(ctx)
        .put(`/events/${randomUUID()}/images/order`)
        .send({ imageIds: [] })
        .expect(404);
    });
  });

  describe('a cancelled event (FR-010)', () => {
    it('refuses delete and reorder, and still lists and serves its images', async () => {
      const [a, b] = await addImages(2);
      await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
      const deleted = await remove(a!).expect(409);
      expect(deleted.body.error.code).toBe('EVENT_CANCELLED');
      const reordered = await reorder({ imageIds: [b, a] }).expect(409);
      expect(reordered.body.error.code).toBe('EVENT_CANCELLED');
      expect(await rows()).toEqual([
        { id: a, position: 1 },
        { id: b, position: 2 },
      ]);
      expect((await listed()).map((i: { id: string }) => i.id)).toEqual([a, b]);
      const served = await asAdmin(ctx).get(`/events/${eventId}/images/${a}`).expect(200);
      expect(served.body).toEqual(PNG);
    });
  });

  describe('deleting the event (FR-011)', () => {
    it('deletes its images with it', async () => {
      await addImages(3);
      await asAdmin(ctx).delete(`/events/${eventId}`).expect(204);
      expect(await ctx.prisma.eventImage.count({ where: { eventId } })).toBe(0);
    });
  });
});
