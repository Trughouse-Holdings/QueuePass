import { asAdmin } from '../setup/authed-request';
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
      .send({ name: 'Yum Center', address: '1 Arena Plaza', seatingCapacity: 22090 })
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
});
