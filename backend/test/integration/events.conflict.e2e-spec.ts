import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * FR-023, FR-026, SC-004, SC-005 — the overlap matrix.
 * Baseline event runs 18:00–21:00, so its reserved interval is [17:00, 21:00).
 */
describe('Scheduling conflict — overlap matrix', () => {
  let ctx: TestContext;
  let venueA: string;
  let venueB: string;

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
      .send({ name: 'Venue A', ...ADDRESS, seatingCapacity: 20000 })
      .expect(201);
    const { body: b } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Venue B', ...ADDRESS, seatingCapacity: 20000 })
      .expect(201);
    venueA = a.id;
    venueB = b.id;

    await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Season Opener',
        locationId: venueA,
        startsAt: '2026-10-01T18:00:00-04:00',
        endsAt: '2026-10-01T21:00:00-04:00',
        totalTicketCapacity: 18000,
        basePrice: '45.00',
      })
      .expect(201);
  });

  const attempt = (locationId: string, startsAt: string, endsAt: string) => ({
    name: 'Second Event',
    locationId,
    startsAt,
    endsAt,
    totalTicketCapacity: 100,
    basePrice: '10.00',
  });

  const rejected: Array<[string, string, string]> = [
    ['partial overlap at the end', '2026-10-01T20:00:00-04:00', '2026-10-01T23:00:00-04:00'],
    ['partial overlap at the start', '2026-10-01T16:00:00-04:00', '2026-10-01T19:00:00-04:00'],
    ['fully contained', '2026-10-01T19:00:00-04:00', '2026-10-01T20:00:00-04:00'],
    ['identical window', '2026-10-01T18:00:00-04:00', '2026-10-01T21:00:00-04:00'],
    ['exactly adjacent', '2026-10-01T21:00:00-04:00', '2026-10-01T22:00:00-04:00'],
    ['fully containing', '2026-10-01T17:00:00-04:00', '2026-10-01T23:00:00-04:00'],
  ];

  it.each(rejected)('rejects %s at the same venue', async (_label, startsAt, endsAt) => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send(attempt(venueA, startsAt, endsAt))
      .expect(409);

    expect(res.body.error.code).toBe('SCHEDULING_CONFLICT');
    expect(await ctx.prisma.event.count()).toBe(1); // no second event created
  });

  it('accepts the identical window at a DIFFERENT venue (FR-026)', async () => {
    await asAdmin(ctx)
      .post('/events')
      .send(attempt(venueB, '2026-10-01T18:00:00-04:00', '2026-10-01T21:00:00-04:00'))
      .expect(201);
    expect(await ctx.prisma.event.count()).toBe(2);
  });

  it('accepts a well-separated window at the same venue', async () => {
    await asAdmin(ctx)
      .post('/events')
      .send(attempt(venueA, '2026-10-02T18:00:00-04:00', '2026-10-02T21:00:00-04:00'))
      .expect(201);
  });
});
