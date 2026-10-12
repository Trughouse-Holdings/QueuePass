import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * FR-029 — two simultaneous conflicting creates must not both succeed.
 *
 * THIS IS THE TEST THAT DISTINGUISHES A CORRECT IMPLEMENTATION. Every other conflict test
 * in this suite passes against a naive service-layer check that reads then writes. Only
 * the database exclusion constraint closes the window between the SELECT and the INSERT,
 * and only this test detects its absence.
 */
describe('Concurrent conflicting creates', () => {
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

  const payload = (name: string, startsAt: string, endsAt: string) => ({
    name,
    locationId: venueId,
    startsAt,
    endsAt,
    totalTicketCapacity: 100,
    basePrice: '10.00',
  });

  it('accepts exactly one of two simultaneous overlapping creates', async () => {
    const results = await Promise.all([
      asAdmin(ctx)
        .post('/events')
        .send(payload('A', '2026-10-01T18:00:00-04:00', '2026-10-01T21:00:00-04:00')),
      asAdmin(ctx)
        .post('/events')
        .send(payload('B', '2026-10-01T19:00:00-04:00', '2026-10-01T22:00:00-04:00')),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await ctx.prisma.event.count()).toBe(1);

    const rejection = results.find((r) => r.status === 409);
    expect(rejection?.body.error.code).toBe('SCHEDULING_CONFLICT');
  });

  it('accepts exactly one when both requests are byte-identical in window', async () => {
    const window = ['2026-10-01T18:00:00-04:00', '2026-10-01T21:00:00-04:00'] as const;

    const results = await Promise.all([
      asAdmin(ctx)
        .post('/events')
        .send(payload('A', ...window)),
      asAdmin(ctx)
        .post('/events')
        .send(payload('B', ...window)),
      asAdmin(ctx)
        .post('/events')
        .send(payload('C', ...window)),
    ]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await ctx.prisma.event.count()).toBe(1);
  });

  it('the database constraint refuses even a direct write that bypasses the service', async () => {
    await ctx.prisma.event.create({
      data: {
        name: 'Direct',
        locationId: venueId,
        startsAt: new Date('2026-10-01T18:00:00-04:00'),
        endsAt: new Date('2026-10-01T21:00:00-04:00'),
        totalTicketCapacity: 100,
        basePrice: '10.00',
      },
    });

    // No service-layer pre-check involved — this is event_no_overlap firing.
    await expect(
      ctx.prisma.event.create({
        data: {
          name: 'Direct Conflict',
          locationId: venueId,
          startsAt: new Date('2026-10-01T20:00:00-04:00'),
          endsAt: new Date('2026-10-01T23:00:00-04:00'),
          totalTicketCapacity: 100,
          basePrice: '10.00',
        },
      }),
    ).rejects.toThrow();

    expect(await ctx.prisma.event.count()).toBe(1);
  });
});
