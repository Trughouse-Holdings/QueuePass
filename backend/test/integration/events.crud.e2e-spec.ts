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
});
