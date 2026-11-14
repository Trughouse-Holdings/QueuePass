import { asAdmin } from '../setup/authed-request';
import { venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 031 FR-007, SC-006 (research R4, R11): under genuinely concurrent requests, two
 * conflicting schedules with ticket types save one whole event and nothing of the other. Spec 038
 * (T009a): the case of a seated schedule racing `007`'s layout save went with that mapping. R7's
 * lock order for 038 is tested in `seat-levels.e2e-spec.ts` (an event save waits for a layout
 * write) and `layouts.concurrency.e2e-spec.ts` (T012).
 */
describe('Scheduling with ticket types, concurrently (031)', () => {
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

  const ROUNDS = 10;

  it('saves exactly one of two overlapping schedules, with only its ticket types', async () => {
    const venueId = await venue(ctx);
    for (let round = 0; round < ROUNDS; round++) {
      const window = windowAt(500 + round * 2);
      const body = (who: string) => ({
        name: `Round ${round} ${who}`,
        locationId: venueId,
        ...window,
        totalTicketCapacity: 300,
        basePrice: '10.00',
        tiers: ['Floor', 'Balcony', 'Box'].map((name) => ({
          name: `${name} ${who}`,
          price: '10.00',
          quantity: 100,
        })),
      });
      const results = await Promise.all([
        asAdmin(ctx).post('/events').send(body('A')),
        asAdmin(ctx).post('/events').send(body('B')),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const winner = results.find((r) => r.status === 201)!;
      const loser = results.find((r) => r.status === 409)!;
      expect(loser.body.error.code).toBe('SCHEDULING_CONFLICT');

      const who = (winner.body.name as string).slice(-1);
      const tiers = await ctx.prisma.ticketTier.findMany({
        where: { event: { name: { startsWith: `Round ${round} ` } } },
        select: { name: true, eventId: true },
      });
      expect(tiers.map((t) => t.name).sort()).toEqual(
        [`Balcony ${who}`, `Box ${who}`, `Floor ${who}`].sort(),
      );
      expect(new Set(tiers.map((t) => t.eventId))).toEqual(new Set([winner.body.id]));
    }
    expect(await ctx.prisma.event.count()).toBe(ROUNDS);
    expect(await ctx.prisma.ticketTier.count()).toBe(ROUNDS * 3);
  });
});
