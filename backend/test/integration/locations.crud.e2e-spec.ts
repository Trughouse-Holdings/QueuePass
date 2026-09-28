import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** FR-038, FR-009, FR-010 — CRUD round-trips through real PostgreSQL. */
describe('Location CRUD persistence', () => {
  let ctx: TestContext;
  const venue = {
    name: 'KFC Yum! Center',
    address: '1 Arena Plaza, Louisville, KY',
    seatingCapacity: 22090,
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  it('creates a venue and returns it with a generated id', async () => {
    const res = await asAdmin(ctx).post('/locations').send(venue).expect(201);
    expect(res.body).toMatchObject(venue);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.createdAt).toEqual(expect.any(String));
  });

  it('persists the venue to the database, not just the response', async () => {
    const { body } = await asAdmin(ctx).post('/locations').send(venue).expect(201);
    const row = await ctx.prisma.location.findUnique({ where: { id: body.id } });
    expect(row).not.toBeNull();
    expect(row?.name).toBe(venue.name);
    expect(row?.seatingCapacity).toBe(22090);
  });

  it('lists venues ordered by name', async () => {
    await asAdmin(ctx)
      .post('/locations')
      .send({ ...venue, name: 'Zed Hall' })
      .expect(201);
    await asAdmin(ctx)
      .post('/locations')
      .send({ ...venue, name: 'Alpha Arena' })
      .expect(201);
    const res = await asAdmin(ctx).get('/locations').expect(200);
    expect(res.body.map((l: { name: string }) => l.name)).toEqual(['Alpha Arena', 'Zed Hall']);
  });

  it('retrieves one venue by id, and 404s for an unknown id', async () => {
    const { body } = await asAdmin(ctx).post('/locations').send(venue).expect(201);
    await asAdmin(ctx).get(`/locations/${body.id}`).expect(200);
    const missing = await asAdmin(ctx)
      .get('/locations/7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40')
      .expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('updates a venue and the change survives a re-read', async () => {
    const { body } = await asAdmin(ctx).post('/locations').send(venue).expect(201);
    await asAdmin(ctx).patch(`/locations/${body.id}`).send({ seatingCapacity: 18000 }).expect(200);
    const reread = await asAdmin(ctx).get(`/locations/${body.id}`).expect(200);
    expect(reread.body.seatingCapacity).toBe(18000);
  });

  it('deletes a venue that has no events', async () => {
    const { body } = await asAdmin(ctx).post('/locations').send(venue).expect(201);
    await asAdmin(ctx).delete(`/locations/${body.id}`).expect(204);
    expect(await ctx.prisma.location.findUnique({ where: { id: body.id } })).toBeNull();
  });
});
