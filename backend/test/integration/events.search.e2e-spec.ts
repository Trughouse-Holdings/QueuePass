import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 004 US2 (FR-006, FR-009) — filtering GET /events by name, venue, and start-date range. */
describe('Event search', () => {
  let ctx: TestContext;
  let yum: string;
  let freedom: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const venue = async (name: string) =>
      (
        await asAdmin(ctx)
          .post('/locations')
          .send({ name, ...ADDRESS, seatingCapacity: 20000 })
          .expect(201)
      ).body.id as string;
    yum = await venue('Yum Center');
    freedom = await venue('Freedom Hall');
    const event = (name: string, locationId: string, startsAt: string, endsAt: string) =>
      asAdmin(ctx)
        .post('/events')
        .send({ name, locationId, startsAt, endsAt, totalTicketCapacity: 100, basePrice: '1.00' })
        .expect(201);
    await event('Spring Show', yum, '2026-04-10T18:00:00Z', '2026-04-10T21:00:00Z');
    await event('Summer SHOWCASE', freedom, '2026-07-01T18:00:00Z', '2026-07-01T21:00:00Z');
    await event('Autumn Gala', yum, '2026-10-01T00:00:00Z', '2026-10-01T03:00:00Z');
    await event('Winter Gala', freedom, '2026-12-20T18:00:00Z', '2026-12-20T21:00:00Z');
  });

  const names = (body: { name: string }[]) => body.map((e) => e.name);

  it('matches name text ignoring case and surrounding spaces, keeping start order', async () => {
    const res = await asAdmin(ctx).get('/events?q=%20%20show%20').expect(200);
    expect(names(res.body)).toEqual(['Spring Show', 'Summer SHOWCASE']);
  });

  it('ignores a blank q', async () => {
    const res = await asAdmin(ctx).get('/events?q=%20%20').expect(200);
    expect(res.body).toHaveLength(4);
  });

  it('matches % and _ literally', async () => {
    const res = await asAdmin(ctx).get('/events?q=%25').expect(200);
    expect(res.body).toEqual([]);
  });

  it('includes events starting exactly at from, and excludes those starting exactly at to', async () => {
    const res = await asAdmin(ctx)
      .get('/events?from=2026-07-01T18:00:00Z&to=2026-10-01T00:00:00Z')
      .expect(200);
    expect(names(res.body)).toEqual(['Summer SHOWCASE']);
  });

  it('accepts from alone and to alone', async () => {
    expect(
      names((await asAdmin(ctx).get('/events?from=2026-10-01T00:00:00Z').expect(200)).body),
    ).toEqual(['Autumn Gala', 'Winter Gala']);
    expect(
      names((await asAdmin(ctx).get('/events?to=2026-07-01T18:00:00Z').expect(200)).body),
    ).toEqual(['Spring Show']);
  });

  it('combines name, venue, and dates', async () => {
    const res = await asAdmin(ctx)
      .get(`/events?q=gala&locationId=${yum}&from=2026-09-01T00:00:00Z`)
      .expect(200);
    expect(names(res.body)).toEqual(['Autumn Gala']);
    const other = await asAdmin(ctx).get(`/events?q=gala&locationId=${freedom}`).expect(200);
    expect(names(other.body)).toEqual(['Winter Gala']);
  });

  it('refuses from at or after to', async () => {
    const res = await asAdmin(ctx)
      .get('/events?from=2026-10-01T00:00:00Z&to=2026-10-01T00:00:00Z')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['from=yesterday', 'malformed from'],
    ['to=2026-13-01', 'malformed to'],
    ['locationId=not-a-uuid', 'malformed locationId'],
    [`q=${'x'.repeat(201)}`, 'q too long'],
    ['sort=name', 'unknown parameter'],
  ])('refuses %s (%s) with 400', async (query) => {
    await asAdmin(ctx).get(`/events?${query}`).expect(400);
  });
});
