import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 002 FR-004, research R7 — a venue with scheduled events cannot be deleted. */
describe('Venue deletion is restricted while events exist', () => {
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

  async function venueWithEvent() {
    const { body: venue } = await asAdmin(ctx)
      .post('/locations')
      .send({
        name: 'Cardinal Stadium',
        ...ADDRESS,
        seatingCapacity: 60000,
      })
      .expect(201);
    const { body: event } = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Season Opener',
        locationId: venue.id,
        startsAt: '2026-10-01T18:00:00-04:00',
        endsAt: '2026-10-01T21:00:00-04:00',
        totalTicketCapacity: 55000,
        basePrice: '45.00',
      })
      .expect(201);
    return { venue, event };
  }

  it('refuses with VENUE_HAS_EVENTS and leaves both rows intact', async () => {
    const { venue, event } = await venueWithEvent();

    const res = await asAdmin(ctx).delete(`/locations/${venue.id}`).expect(409);
    expect(res.body.error.code).toBe('VENUE_HAS_EVENTS');

    expect(await ctx.prisma.location.findUnique({ where: { id: venue.id } })).not.toBeNull();
    expect(await ctx.prisma.event.findUnique({ where: { id: event.id } })).not.toBeNull();
  });

  it('allows deletion once the events are gone', async () => {
    const { venue, event } = await venueWithEvent();
    await asAdmin(ctx).delete(`/events/${event.id}`).expect(204);
    await asAdmin(ctx).delete(`/locations/${venue.id}`).expect(204);
  });

  it('is enforced by the database, so a direct client cannot orphan events', async () => {
    const { venue } = await venueWithEvent();
    // Bypassing the service entirely — the FK is ON DELETE RESTRICT (FR-013).
    await expect(ctx.prisma.location.delete({ where: { id: venue.id } })).rejects.toThrow();
  });

  async function venueWithEvents(n: number, name = 'Yum Center') {
    const { body: venue } = await asAdmin(ctx)
      .post('/locations')
      .send({ name, ...ADDRESS, seatingCapacity: 22090 })
      .expect(201);
    for (let i = 0; i < n; i++) {
      await asAdmin(ctx)
        .post('/events')
        .send({
          name: `Show ${i + 1}`,
          locationId: venue.id,
          // A day apart, so the 60-minute rule never interferes.
          startsAt: `2026-11-0${i + 1}T18:00:00Z`,
          endsAt: `2026-11-0${i + 1}T21:00:00Z`,
          totalTicketCapacity: 100,
          basePrice: '10.00',
        })
        .expect(201);
    }
    return venue;
  }

  it('names the venue and says 1 event blocks it', async () => {
    const venue = await venueWithEvents(1);
    const res = await asAdmin(ctx).delete(`/locations/${venue.id}`).expect(409);
    expect(res.body.error).toEqual({
      code: 'VENUE_HAS_EVENTS',
      message:
        'Cannot delete "Yum Center": 1 event is still scheduled there. Delete or move them first.',
      details: { eventCount: 1 },
    });
  });

  it('counts several blocking events', async () => {
    const venue = await venueWithEvents(3);
    const res = await asAdmin(ctx).delete(`/locations/${venue.id}`).expect(409);
    expect(res.body.error.message).toBe(
      'Cannot delete "Yum Center": 3 events are still scheduled there. Delete or move them first.',
    );
    expect(res.body.error.details.eventCount).toBe(3);
    expect(await ctx.prisma.event.count({ where: { locationId: venue.id } })).toBe(3);
  });

  it('404s for an unknown venue', async () => {
    const res = await asAdmin(ctx)
      .delete('/locations/7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40')
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('deletes an empty venue once: 204, then 404', async () => {
    const venue = await venueWithEvents(0);
    await asAdmin(ctx).delete(`/locations/${venue.id}`).expect(204);
    await asAdmin(ctx).delete(`/locations/${venue.id}`).expect(404);
  });
});
