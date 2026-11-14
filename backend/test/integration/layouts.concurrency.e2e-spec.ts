import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asAdmin } from '../setup/authed-request';
import { customer, event, layoutRefs, seatEventOn, venue } from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';

/**
 * Spec 038 research R7 (Constitution IV): a layout write locks the venue, then the layout, then the
 * scheduled events using it; a hold locks only its event; an event save locks the venue for share,
 * then the event. Started together, each pair is decided one way or the other, never both and
 * never half: genuinely concurrent requests (`Promise.all` on the app's own connections).
 */
describe('Venue layouts under concurrency (038)', () => {
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

  const CLUB = {
    name: 'Club room',
    levels: [
      { name: 'Front', color: 'violet' },
      { name: 'Back', color: 'teal' },
    ],
    sections: [
      { name: 'Floor A', rows: 2, seatsPerRow: 10, level: 'Front' },
      { name: 'Floor B', rows: 2, seatsPerRow: 10, level: 'Back' },
    ],
  };

  async function clubWithEvent(levels = CLUB.levels, prices = { Front: '50.00', Back: '30.00' }) {
    const venueId = await venue(ctx);
    const layout = await asAdmin(ctx)
      .post(`/locations/${venueId}/layouts`)
      .send({ ...CLUB, levels })
      .expect(201);
    const refs = await layoutRefs(ctx, layout.body.id);
    const eventId = await event(ctx, venueId, { name: 'Cardinals vs. Duke', capacity: 40 });
    await seatEventOn(ctx, eventId, refs, prices);
    return { layoutId: layout.body.id as string, refs, eventId };
  }

  it('decides a lines edit and a hold of a seat it deletes one way or the other, 10 times', async () => {
    const outcomes = new Set<string>();
    for (let trial = 0; trial < 10; trial++) {
      await resetDb(ctx.prisma);
      const { layoutId, refs, eventId } = await clubWithEvent();
      const buyer = await customer(ctx, 1);
      // The edit takes Floor B away; the hold is of Floor B, row 1, seat 1.
      const [edit, hold] = await Promise.all([
        asAdmin(ctx)
          .put(`/layouts/${layoutId}`)
          .send({ levels: CLUB.levels, sections: [CLUB.sections[0]] }),
        buyer
          .post(`/events/${eventId}/reservation`)
          .send({ seats: [{ sectionId: refs.sections['Floor B'], row: 1, seat: 1 }] }),
      ]);
      const live = await ctx.prisma.seatHold.findMany({ where: { eventId, releasedAt: null } });
      if (hold.status === 201) {
        // The hold came first: the edit saw it and was refused; the seat is still there.
        expect(edit.status).toBe(409);
        expect(edit.body.error.code).toBe('LAYOUT_IN_USE');
        expect(live).toHaveLength(1);
        expect(live[0].seatId).toBe(refs.seat('Floor B', 1, 1));
        expect(await ctx.prisma.seat.count({ where: { id: live[0].seatId! } })).toBe(1);
        outcomes.add('hold');
      } else {
        // The edit came first: the hold saw the new layout, without Floor B.
        expect(edit.status).toBe(200);
        expect(hold.status).toBe(400);
        expect(live).toEqual([]);
        expect(await ctx.prisma.section.count({ where: { id: refs.sections['Floor B'] } })).toBe(0);
        outcomes.add('edit');
      }
    }
    expect(outcomes.size).toBeGreaterThan(0);
  }, 60_000);

  it('saves exactly one of two imports with one name sent at once', async () => {
    const venueId = await venue(ctx);
    const file = JSON.parse(
      readFileSync(join(__dirname, '../fixtures/layouts/small.json'), 'utf8'),
    ) as Record<string, unknown>;
    for (let trial = 0; trial < 5; trial++) {
      await ctx.prisma.layout.deleteMany();
      const results = await Promise.all(
        [0, 1].map(() =>
          asAdmin(ctx).post(`/locations/${venueId}/layouts/import`).send({ name: 'Twin', file }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.error.code).toBe('LAYOUT_NAME_TAKEN');
      expect(await ctx.prisma.layout.count()).toBe(1);
    }
  });

  // From T009a: an event's seating save racing a lines edit of its layout. The edit moves Floor B
  // to Middle, a level with no seats until then; the save prices Middle. The edit is refused
  // exactly when it ran before the save (Middle unpriced), and accepted when after.
  it("decides a lines edit by the event's prices as saved, racing an event's seating save, 10 times", async () => {
    const levels = [...CLUB.levels, { name: 'Middle', color: 'blue' }];
    for (let trial = 0; trial < 10; trial++) {
      await resetDb(ctx.prisma);
      const { layoutId, refs, eventId } = await clubWithEvent(levels);
      const [edit, save] = await Promise.all([
        asAdmin(ctx)
          .put(`/layouts/${layoutId}`)
          .send({
            levels,
            sections: [CLUB.sections[0], { ...CLUB.sections[1], level: 'Middle' }],
          }),
        asAdmin(ctx)
          .patch(`/events/${eventId}`)
          .send({
            layoutId,
            levelPrices: [
              { levelId: refs.levels.Front, price: '50.00' },
              { levelId: refs.levels.Back, price: '30.00' },
              { levelId: refs.levels.Middle, price: '40.00' },
            ],
          }),
      ]);
      expect(save.status).toBe(200);
      expect([200, 409]).toContain(edit.status);
      const middle = await ctx.prisma.eventLevelPrice.findUnique({
        where: { eventId_levelId: { eventId, levelId: refs.levels.Middle } },
      });
      expect(middle?.price.toFixed(2)).toBe('40.00');
      const floorB = await ctx.prisma.section.findUniqueOrThrow({
        where: { id: refs.sections['Floor B'] },
      });
      expect(floorB.levelId).toBe(edit.status === 200 ? refs.levels.Middle : refs.levels.Back);
      if (edit.status === 409) expect(edit.body.error.code).toBe('LAYOUT_IN_USE');
    }
  }, 60_000);
});
