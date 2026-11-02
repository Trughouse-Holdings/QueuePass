import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** FR-018, FR-021 — field-level rules. */
describe('Event field validation', () => {
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

  const base = () => ({
    name: 'Season Opener',
    locationId: venueId,
    startsAt: '2026-10-01T18:00:00-04:00',
    endsAt: '2026-10-01T21:00:00-04:00',
    totalTicketCapacity: 18000,
    basePrice: '45.00',
  });

  it('rejects endsAt equal to startsAt (FR-018)', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({ ...base(), endsAt: base().startsAt })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects endsAt before startsAt (FR-018)', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({ ...base(), endsAt: '2026-10-01T17:00:00-04:00' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a negative base price (FR-021)', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({ ...base(), basePrice: '-1.00' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('accepts a zero base price', async () => {
    await asAdmin(ctx)
      .post('/events')
      .send({ ...base(), basePrice: '0.00' })
      .expect(201);
  });

  it.each([0, -10])('rejects totalTicketCapacity of %s', async (cap) => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({ ...base(), totalTicketCapacity: cap })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an empty name', async () => {
    await asAdmin(ctx)
      .post('/events')
      .send({ ...base(), name: '   ' })
      .expect(400);
  });

  // Issue #117: `@IsOptional` let a null through, to the database (a 500) or silently ignored.
  it.each([
    ['a null name', { name: null }, /name/],
    ['a null locationId', { locationId: null }, /locationId/],
    ['a null startsAt', { startsAt: null }, /startsAt/],
    ['a null endsAt', { endsAt: null }, /endsAt/],
    ['a null totalTicketCapacity', { totalTicketCapacity: null }, /totalTicketCapacity/],
    ['a null basePrice', { basePrice: null }, /basePrice/],
    ['a null name beside a valid price', { name: null, basePrice: '50.00' }, /name/],
  ])('rejects %s on an edit with VALIDATION_FAILED, event unchanged', async (_l, body, field) => {
    const created = await asAdmin(ctx).post('/events').send(base()).expect(201);
    const before = await ctx.prisma.event.findUniqueOrThrow({ where: { id: created.body.id } });
    const res = await asAdmin(ctx).patch(`/events/${created.body.id}`).send(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body.error.details?.fields)).toMatch(field);
    expect(await ctx.prisma.event.findUniqueOrThrow({ where: { id: created.body.id } })).toEqual(
      before,
    );
  });

  // Fields where null has a meaning keep it: 016 (clears the limit), 025 R6 (left out).
  it('still takes a null maxTicketsPerCustomer and doorsOpenAt on an edit (#117)', async () => {
    const created = await asAdmin(ctx)
      .post('/events')
      .send({ ...base(), maxTicketsPerCustomer: 4 })
      .expect(201);
    const res = await asAdmin(ctx)
      .patch(`/events/${created.body.id}`)
      .send({ maxTicketsPerCustomer: null, doorsOpenAt: null })
      .expect(200);
    expect(res.body.maxTicketsPerCustomer).toBeNull();
    expect(res.body.doorsOpenAt).toBe(created.body.doorsOpenAt);
  });
});
