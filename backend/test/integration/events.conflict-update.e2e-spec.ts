import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** FR-024, FR-025 + spec Edge Cases — the update path. */
describe('Scheduling conflict on update', () => {
  let ctx: TestContext;
  let venueA: string;
  let venueB: string;
  let first: { id: string };
  let second: { id: string };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);

    const { body: a } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Venue A', address: '1 A St', seatingCapacity: 20000 })
      .expect(201);
    const { body: b } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Venue B', address: '2 B St', seatingCapacity: 20000 })
      .expect(201);
    venueA = a.id;
    venueB = b.id;

    const mk = (name: string, locationId: string, startsAt: string, endsAt: string) =>
      asAdmin(ctx)
        .post('/events')
        .send({ name, locationId, startsAt, endsAt, totalTicketCapacity: 100, basePrice: '10.00' })
        .expect(201);

    ({ body: first } = await mk(
      'First',
      venueA,
      '2026-10-01T18:00:00-04:00',
      '2026-10-01T21:00:00-04:00',
    ));
    ({ body: second } = await mk(
      'Second',
      venueA,
      '2026-10-02T18:00:00-04:00',
      '2026-10-02T21:00:00-04:00',
    ));
  });

  it('rejects an edit that moves an event onto another at the same venue (FR-024)', async () => {
    const res = await asAdmin(ctx)
      .patch(`/events/${second.id}`)
      .send({ startsAt: '2026-10-01T19:00:00-04:00', endsAt: '2026-10-01T20:00:00-04:00' })
      .expect(409);

    expect(res.body.error.code).toBe('SCHEDULING_CONFLICT');
    expect(res.body.error.details.conflictingEvent.name).toBe('First');

    // The original row is untouched
    const unchanged = await ctx.prisma.event.findUnique({ where: { id: second.id } });
    expect(unchanged?.startsAt.toISOString()).toBe(
      new Date('2026-10-02T18:00:00-04:00').toISOString(),
    );
  });

  it('accepts saving an event without moving its time — no self-conflict (FR-025)', async () => {
    await asAdmin(ctx).patch(`/events/${first.id}`).send({ name: 'First — renamed' }).expect(200);
  });

  it('accepts re-submitting the identical window for the same event (FR-025)', async () => {
    await asAdmin(ctx)
      .patch(`/events/${first.id}`)
      .send({ startsAt: '2026-10-01T18:00:00-04:00', endsAt: '2026-10-01T21:00:00-04:00' })
      .expect(200);
  });

  it('checks the DESTINATION venue when only the venue changes', async () => {
    // Occupy the same window at Venue B
    await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'B Occupant',
        locationId: venueB,
        startsAt: '2026-10-02T18:00:00-04:00',
        endsAt: '2026-10-02T21:00:00-04:00',
        totalTicketCapacity: 100,
        basePrice: '10.00',
      })
      .expect(201);

    // Moving `second` from A to B must be checked against B, where it now conflicts
    const res = await asAdmin(ctx)
      .patch(`/events/${second.id}`)
      .send({ locationId: venueB })
      .expect(409);
    expect(res.body.error.code).toBe('SCHEDULING_CONFLICT');
    expect(res.body.error.details.conflictingEvent.name).toBe('B Occupant');
  });

  it('allows moving to a venue where the window is free', async () => {
    await asAdmin(ctx).patch(`/events/${second.id}`).send({ locationId: venueB }).expect(200);
  });
});
