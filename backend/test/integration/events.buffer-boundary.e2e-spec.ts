import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * FR-040 — both sides of the 60-minute buffer boundary.
 *
 * Against an event ending at 21:00: a start at 21:59 is rejected, 22:00 is accepted.
 *
 * If BOTH of these fail, the buffer was applied to both interval bounds, demanding a
 * 120-minute gap instead of the specified 60 (research R3).
 */
describe('Scheduling buffer boundary (60 minutes)', () => {
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
    const { body: venue } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Yum Center', ...ADDRESS, seatingCapacity: 22090 })
      .expect(201);
    venueId = venue.id;

    await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Season Opener',
        locationId: venueId,
        startsAt: '2026-10-01T18:00:00-04:00',
        endsAt: '2026-10-01T21:00:00-04:00',
        totalTicketCapacity: 18000,
        basePrice: '45.00',
      })
      .expect(201);
  });

  const at = (startsAt: string, endsAt: string) => ({
    name: 'Next Up',
    locationId: venueId,
    startsAt,
    endsAt,
    totalTicketCapacity: 100,
    basePrice: '10.00',
  });

  it('REJECTS a start at 21:59 — only 59 minutes of clearance', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send(at('2026-10-01T21:59:00-04:00', '2026-10-01T23:00:00-04:00'))
      .expect(409);
    expect(res.body.error.code).toBe('SCHEDULING_CONFLICT');
  });

  it('ACCEPTS a start at 22:00 — exactly 60 minutes of clearance', async () => {
    await asAdmin(ctx)
      .post('/events')
      .send(at('2026-10-01T22:00:00-04:00', '2026-10-01T23:00:00-04:00'))
      .expect(201);
  });

  it('REJECTS an event ending at 17:01, 59 minutes before the 18:00 start', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send(at('2026-10-01T16:00:00-04:00', '2026-10-01T17:01:00-04:00'))
      .expect(409);
    expect(res.body.error.code).toBe('SCHEDULING_CONFLICT');
  });

  it('ACCEPTS an event ending at 17:00, exactly 60 minutes before the 18:00 start', async () => {
    await asAdmin(ctx)
      .post('/events')
      .send(at('2026-10-01T16:00:00-04:00', '2026-10-01T17:00:00-04:00'))
      .expect(201);
  });

  it('reports bufferMinutes: 60 in the error details', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send(at('2026-10-01T21:30:00-04:00', '2026-10-01T23:00:00-04:00'))
      .expect(409);
    expect(res.body.error.details.bufferMinutes).toBe(60);
  });
});
