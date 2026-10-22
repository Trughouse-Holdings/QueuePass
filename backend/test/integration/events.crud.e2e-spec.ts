import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * FR-038, FR-015, FR-016, FR-017 — Event CRUD round-trips through real PostgreSQL.
 * Every window here is >60 minutes apart so the scheduling rule is not exercised.
 */
describe('Event CRUD persistence', () => {
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
    const { body } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Yum Center', ...ADDRESS, seatingCapacity: 22090 })
      .expect(201);
    venueId = body.id;
  });

  const event = () => ({
    name: 'Season Opener',
    locationId: venueId,
    startsAt: '2026-10-01T18:00:00-04:00',
    endsAt: '2026-10-01T21:00:00-04:00',
    totalTicketCapacity: 18000,
    basePrice: '45.00',
  });

  it('creates an event and returns it with its venue embedded', async () => {
    const res = await asAdmin(ctx).post('/events').send(event()).expect(201);
    expect(res.body.name).toBe('Season Opener');
    expect(res.body.location.name).toBe('Yum Center');
    expect(res.body.basePrice).toBe('45.00');
  });

  it('persists to the database, not just the response', async () => {
    const { body } = await asAdmin(ctx).post('/events').send(event()).expect(201);
    const row = await ctx.prisma.event.findUnique({ where: { id: body.id } });
    expect(row).not.toBeNull();
    expect(row?.totalTicketCapacity).toBe(18000);
    expect(row?.basePrice.toString()).toBe('45');
  });

  it('lists events ordered by start time', async () => {
    // 6 hours apart — well beyond the 60-minute buffer
    await asAdmin(ctx)
      .post('/events')
      .send({
        ...event(),
        name: 'Later',
        startsAt: '2026-10-02T18:00:00-04:00',
        endsAt: '2026-10-02T21:00:00-04:00',
      })
      .expect(201);
    await asAdmin(ctx)
      .post('/events')
      .send({ ...event(), name: 'Earlier' })
      .expect(201);
    const res = await asAdmin(ctx).get('/events').expect(200);
    expect(res.body.map((e: { name: string }) => e.name)).toEqual(['Earlier', 'Later']);
  });

  it('filters by locationId', async () => {
    const { body: other } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Freedom Hall', ...ADDRESS, seatingCapacity: 19000 })
      .expect(201);
    await asAdmin(ctx).post('/events').send(event()).expect(201);
    await asAdmin(ctx)
      .post('/events')
      .send({ ...event(), locationId: other.id, name: 'Other Venue Show' })
      .expect(201);

    const res = await asAdmin(ctx).get(`/events?locationId=${other.id}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Other Venue Show');
  });

  it('updates an event and the change survives a re-read', async () => {
    const { body } = await asAdmin(ctx).post('/events').send(event()).expect(201);
    await asAdmin(ctx)
      .patch(`/events/${body.id}`)
      .send({ endsAt: '2026-10-01T22:00:00-04:00' })
      .expect(200);
    const reread = await asAdmin(ctx).get(`/events/${body.id}`).expect(200);
    expect(new Date(reread.body.endsAt).toISOString()).toBe(
      new Date('2026-10-01T22:00:00-04:00').toISOString(),
    );
  });

  it('deletes an event and frees the window', async () => {
    const { body } = await asAdmin(ctx).post('/events').send(event()).expect(201);
    await asAdmin(ctx).delete(`/events/${body.id}`).expect(204);
    // The exact window is now available again
    await asAdmin(ctx)
      .post('/events')
      .send({ ...event(), name: 'Replacement' })
      .expect(201);
  });

  it('deletes an event once: 204, then 404 (spec 002 FR-010)', async () => {
    const { body } = await asAdmin(ctx).post('/events').send(event()).expect(201);
    await asAdmin(ctx).delete(`/events/${body.id}`).expect(204);
    const again = await asAdmin(ctx).delete(`/events/${body.id}`).expect(404);
    expect(again.body.error.code).toBe('NOT_FOUND');
  });

  it('404s deleting an unknown event', async () => {
    await asAdmin(ctx).delete('/events/7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40').expect(404);
  });

  // Spec 014 FR-012; research R6: every event response lists its images, metadata only.
  describe('images in every event response', () => {
    const hasNoBytes = (body: unknown) => expect(JSON.stringify(body)).not.toMatch(/"bytes"/);

    it('a new event has images: [] in create, get, list, update, and cancel', async () => {
      const created = await asAdmin(ctx).post('/events').send(event()).expect(201);
      expect(created.body.images).toEqual([]);
      const id = created.body.id;
      expect((await asAdmin(ctx).get(`/events/${id}`).expect(200)).body.images).toEqual([]);
      expect((await asAdmin(ctx).get('/events').expect(200)).body[0].images).toEqual([]);
      const updated = await asAdmin(ctx).patch(`/events/${id}`).send({ name: 'Renamed' });
      expect(updated.status).toBe(200);
      expect(updated.body.images).toEqual([]);
      const cancelled = await asAdmin(ctx).post(`/events/${id}/cancel`).expect(200);
      expect(cancelled.body.event.images).toEqual([]);
    });

    it('lists stored images by position with exactly id, position, contentType, byteSize', async () => {
      const created = await asAdmin(ctx).post('/events').send(event()).expect(201);
      const id: string = created.body.id;
      const second = '0f8f7a8e-5a39-4c1e-9b7e-2d3c4b5a6f70';
      const first = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
      await ctx.prisma.$executeRaw`
        INSERT INTO "EventImage" ("id", "eventId", "position", "contentType", "byteSize", "bytes")
        VALUES (${second}::uuid, ${id}::uuid, 2, 'image/webp', 4, ${Buffer.from([1, 2, 3, 4])}),
               (${first}::uuid, ${id}::uuid, 1, 'image/png', 3, ${Buffer.from([1, 2, 3])})`;
      const expected = [
        { id: first, position: 1, contentType: 'image/png', byteSize: 3 },
        { id: second, position: 2, contentType: 'image/webp', byteSize: 4 },
      ];

      const got = await asAdmin(ctx).get(`/events/${id}`).expect(200);
      expect(got.body.images).toEqual(expected);
      hasNoBytes(got.body);
      const list = await asAdmin(ctx).get('/events').expect(200);
      expect(list.body[0].images).toEqual(expected);
      hasNoBytes(list.body);
      const updated = await asAdmin(ctx).patch(`/events/${id}`).send({ name: 'Renamed' });
      expect(updated.status).toBe(200);
      expect(updated.body.images).toEqual(expected);
      hasNoBytes(updated.body);
      const cancelled = await asAdmin(ctx).post(`/events/${id}/cancel`).expect(200);
      expect(cancelled.body.event.images).toEqual(expected);
      hasNoBytes(cancelled.body);
    });
  });
});
