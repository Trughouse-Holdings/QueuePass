import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** FR-027 — the conflict error must name the event responsible. */
describe('SCHEDULING_CONFLICT error contract', () => {
  let ctx: TestContext;
  let venueId: string;
  let existing: { id: string; name: string };

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
      .send({ name: 'Yum Center', address: '1 Arena Plaza', seatingCapacity: 22090 })
      .expect(201);
    venueId = venue.id;
    ({ body: existing } = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Season Opener',
        locationId: venueId,
        startsAt: '2026-10-01T18:00:00-04:00',
        endsAt: '2026-10-01T21:00:00-04:00',
        totalTicketCapacity: 18000,
        basePrice: '45.00',
      })
      .expect(201));
  });

  it('matches the envelope declared in contracts/openapi.yaml', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Clashing Show',
        locationId: venueId,
        startsAt: '2026-10-01T20:00:00-04:00',
        endsAt: '2026-10-01T23:00:00-04:00',
        totalTicketCapacity: 100,
        basePrice: '10.00',
      })
      .expect(409);

    expect(res.body).toEqual({
      error: {
        code: 'SCHEDULING_CONFLICT',
        message: expect.any(String),
        details: {
          bufferMinutes: 60,
          conflictingEvent: {
            id: existing.id,
            name: 'Season Opener',
            startsAt: expect.any(String),
            endsAt: expect.any(String),
          },
        },
      },
    });
  });

  it('carries a message an admin can act on without reading logs (SC-006)', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Clashing Show',
        locationId: venueId,
        startsAt: '2026-10-01T20:00:00-04:00',
        endsAt: '2026-10-01T23:00:00-04:00',
        totalTicketCapacity: 100,
        basePrice: '10.00',
      })
      .expect(409);

    expect(res.body.error.message).toContain('Season Opener');
    expect(res.body.error.message).toContain('60 minutes');
  });

  it('is rejected identically when submitted directly to the API (FR-028, SC-008)', async () => {
    // Same request shape a curl bypassing the admin web app would send.
    const res = await asAdmin(ctx)
      .post('/events')
      .set('user-agent', 'curl/8.0.0')
      .send({
        name: 'Bypass Attempt',
        locationId: venueId,
        startsAt: '2026-10-01T20:00:00-04:00',
        endsAt: '2026-10-01T23:00:00-04:00',
        totalTicketCapacity: 100,
        basePrice: '10.00',
      })
      .expect(409);

    expect(res.body.error.code).toBe('SCHEDULING_CONFLICT');
    expect(await ctx.prisma.event.count()).toBe(1);
  });
});
