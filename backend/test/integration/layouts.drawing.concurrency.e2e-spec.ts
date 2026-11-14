import { asAdmin } from '../setup/authed-request';
import { customer, event, layoutRefs, seatEventOn, venue } from '../setup/fixtures';
import { drawingToInput, newDrawing } from '../setup/layout-drawing';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';

/**
 * Spec 039 research R8 (T046, Constitution IV): a drawing save locks the venue, then the layout,
 * then the scheduled events using it; a hold locks only its event. A save that deletes section 103
 * and 10 holds of 10 different seats (5 of 103, 5 of 101, which the save keeps), started together,
 * are decided one way or the other: either a hold committed first, and the save is refused as
 * locked (the layout unchanged, so every hold stands), or the save committed first, and every hold
 * of a deleted seat failed while every hold of a kept seat succeeded. Never a hold on a seat that
 * is gone. Five times.
 */
describe('Layout drawings under concurrency (039)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('decides a save and 10 holds at once one way or the other, 5 times', async () => {
    const outcomes = new Set<string>();
    for (let trial = 0; trial < 5; trial++) {
      await resetDb(ctx.prisma);
      const venueId = await venue(ctx);
      const layout = (
        await asAdmin(ctx).post(`/locations/${venueId}/layouts/drawing`).send(newDrawing())
      ).body;
      const refs = await layoutRefs(ctx, layout.id);
      const eventId = await event(ctx, venueId, { name: 'Cardinals vs. Duke', capacity: 20 });
      await seatEventOn(ctx, eventId, refs, { Front: '50.00', Back: '30.00' });

      const read = await asAdmin(ctx).get(`/layouts/${layout.id}/drawing`).expect(200);
      const body = drawingToInput(read.body) as { sections: unknown[] };
      body.sections = body.sections.slice(0, 2);

      const gone = [1, 2, 3, 4, 5].map((seat) => ({ section: '103', row: 1, seat }));
      const kept = [1, 2, 3, 4].map((seat) => ({ section: '101', row: 2, seat }));
      kept.push({ section: '101', row: 3, seat: 1 });
      const wanted = [...gone, ...kept];
      const buyers = await Promise.all(wanted.map((_, i) => customer(ctx, i + 1)));

      const [save, ...holds] = await Promise.all([
        asAdmin(ctx).put(`/layouts/${layout.id}/drawing`).send(body),
        ...wanted.map((s, i) =>
          buyers[i]
            .post(`/events/${eventId}/reservation`)
            .send({ seats: [{ sectionId: refs.sections[s.section], row: s.row, seat: s.seat }] }),
        ),
      ]);

      const live = await ctx.prisma.seatHold.findMany({ where: { eventId, releasedAt: null } });
      // Never a live hold without its seat (CHECK seat_hold_live_has_seat), nor on a seat gone.
      for (const h of live) {
        expect(h.seatId).not.toBeNull();
        expect(await ctx.prisma.seat.count({ where: { id: h.seatId! } })).toBe(1);
      }
      if (save.status === 200) {
        // The save came first: holds of 103 failed, holds of 101 succeeded.
        expect(holds.slice(0, 5).map((h) => h.status === 201)).toEqual([
          false,
          false,
          false,
          false,
          false,
        ]);
        expect(holds.slice(5).map((h) => h.status)).toEqual([201, 201, 201, 201, 201]);
        expect(live).toHaveLength(5);
        expect(await ctx.prisma.section.count({ where: { id: refs.sections['103'] } })).toBe(0);
        outcomes.add('save');
      } else {
        // A hold came first: the save was refused as locked and the layout is as it was.
        expect(save.status).toBe(409);
        expect(save.body.error.code).toBe('LAYOUT_IN_USE');
        expect(holds.map((h) => h.status)).toEqual(Array(10).fill(201));
        expect(live).toHaveLength(10);
        expect(await ctx.prisma.section.count({ where: { id: refs.sections['103'] } })).toBe(1);
        const after = await ctx.prisma.layout.findUniqueOrThrow({ where: { id: layout.id } });
        expect(after.revision).toBe(1);
        outcomes.add('hold');
      }
    }
    // Either order is right; which one wins is up to the scheduler.
    expect(outcomes.size).toBeGreaterThan(0);
  }, 120_000);
});
