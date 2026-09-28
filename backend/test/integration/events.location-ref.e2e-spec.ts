import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** FR-019 — an event may not reference a venue that does not exist. */
describe('Event venue reference', () => {
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

  it('404s for an unknown locationId and creates no orphaned event', async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Ghost Show',
        locationId: '7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40',
        startsAt: '2026-10-01T18:00:00-04:00',
        endsAt: '2026-10-01T21:00:00-04:00',
        totalTicketCapacity: 100,
        basePrice: '10.00',
      })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await ctx.prisma.event.count()).toBe(0);
  });

  it('rejects a malformed locationId with a validation error, not a 500', async () => {
    await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Bad Ref',
        locationId: 'not-a-uuid',
        startsAt: '2026-10-01T18:00:00-04:00',
        endsAt: '2026-10-01T21:00:00-04:00',
        totalTicketCapacity: 100,
        basePrice: '10.00',
      })
      .expect(400);
  });
});
