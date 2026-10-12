import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * research.md R8 + spec Edge Cases — lowering seating capacity below an existing event's
 * ticket capacity must be refused, not silently allowed to corrupt the event.
 */
describe('Venue seating capacity reduction', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  async function setup() {
    const { body: venue } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Yum Center', ...ADDRESS, seatingCapacity: 22090 })
      .expect(201);
    await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Season Opener',
        locationId: venue.id,
        startsAt: '2026-10-01T18:00:00-04:00',
        endsAt: '2026-10-01T21:00:00-04:00',
        totalTicketCapacity: 900,
        basePrice: '45.00',
      })
      .expect(201);
    return venue;
  }

  it('refuses a reduction below an existing event, naming the offending event', async () => {
    const venue = await setup();
    const res = await asAdmin(ctx)
      .patch(`/locations/${venue.id}`)
      .send({ seatingCapacity: 500 })
      .expect(409);

    expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(res.body.error.details.conflictingEvent.name).toBe('Season Opener');
    expect(res.body.error.details.conflictingEvent.totalTicketCapacity).toBe(900);
  });

  it('allows a reduction that still accommodates every event', async () => {
    const venue = await setup();
    await asAdmin(ctx).patch(`/locations/${venue.id}`).send({ seatingCapacity: 900 }).expect(200);
  });

  it('allows any increase', async () => {
    const venue = await setup();
    await asAdmin(ctx).patch(`/locations/${venue.id}`).send({ seatingCapacity: 30000 }).expect(200);
  });
});
