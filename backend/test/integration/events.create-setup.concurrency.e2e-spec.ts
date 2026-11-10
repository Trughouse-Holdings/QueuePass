import { asAdmin } from '../setup/authed-request';
import { venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 031 FR-007, SC-006 (research R4, R11): under genuinely concurrent requests, two
 * conflicting schedules with ticket types save one whole event and nothing of the other, and a
 * seated schedule and a layout save at its venue never interleave.
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

  it('never interleaves a seated schedule with a layout save at its venue', async () => {
    const outcomes = { scheduleFirst: 0, layoutFirst: 0 };
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await venue(ctx, `Race Hall ${round}`);
      const first = await asAdmin(ctx)
        .put(`/locations/${venueId}/layout`)
        .send({
          sections: [
            { name: 'front', rows: 1, seatsPerRow: 10 },
            { name: 'back', rows: 2, seatsPerRow: 10 },
          ],
        })
        .expect(200);
      const [front, back] = first.body.sections.map((s: { id: string }) => s.id);
      const [schedule, layout] = await Promise.all([
        asAdmin(ctx)
          .post('/events')
          .send({
            name: `Seated ${round}`,
            locationId: venueId,
            ...windowAt(600 + round),
            basePrice: '10.00',
            reservedSeating: true,
            tiers: [
              { name: 'Front', price: '20.00', sectionIds: [front] },
              { name: 'Back', price: '10.00', sectionIds: [back] },
              { name: 'Spare', price: '5.00' },
            ],
          }),
        asAdmin(ctx)
          .put(`/locations/${venueId}/layout`)
          .send({
            sections: [
              { name: 'front renamed', rows: 1, seatsPerRow: 10 },
              { name: 'back', rows: 2, seatsPerRow: 10 },
            ],
          }),
      ]);
      expect(layout.status).toBe(200);
      const events = await ctx.prisma.event.findMany({
        where: { locationId: venueId },
        include: { tiers: true, sectionTiers: true },
      });

      if (schedule.status === 400) {
        // The layout saved first: the schedule named gone sections and nothing of it remains.
        outcomes.layoutFirst++;
        expect(schedule.body.error.code).toBe('VALIDATION_FAILED');
        expect(schedule.body.error.details.fields[0]).toMatch(/^tiers\.0\.sectionIds /);
        expect(events).toHaveLength(0);
      } else {
        // The schedule saved first, whole; the layout save then dropped its mappings (007 R11).
        outcomes.scheduleFirst++;
        expect(schedule.status).toBe(201);
        expect(events).toHaveLength(1);
        expect(events[0].sectionTiers).toHaveLength(0);
        expect(events[0].tiers.map((t) => t.quantity)).toEqual([0, 0, 0]);
        expect(events[0].totalTicketCapacity).toBe(30);
      }
      // Never a mapping to a section that is gone.
      const orphans = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "SectionTier" st
        LEFT JOIN "Section" s ON s."id" = st."sectionId" WHERE s."id" IS NULL`;
      expect(Number(orphans[0].n)).toBe(0);
    }
    expect(outcomes.scheduleFirst + outcomes.layoutFirst).toBe(ROUNDS);
  });
});
