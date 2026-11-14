import { asAdmin, anon, as } from '../setup/authed-request';
import {
  HOLDER,
  agent,
  customer,
  event,
  insertLayout,
  reserveThenOrder,
  seatedEvent,
  sellSeats,
  venue,
  type InsertedLayout,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor, tokenFor } from '../setup/tokens';

/**
 * Spec 038 US3 (FR-016, FR-028, FR-029; research R11, R12): the venue map of a seated event, by
 * section with counts per level and state, and one section seat by seat, each with the event's
 * seat-change `seq`. The same for every caller, and never naming a buyer. Every response through
 * the request helpers is checked against the contract (`getVenueMap`, `getVenueMapSection`).
 */
describe('Venue map (038 US3)', () => {
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
    venueId = await venue(ctx, 'Map Hall');
  });

  /** 70 seats: Floor A (Front), Floor B (Back), 3 rows of 10; Balcony (Upper), 2 rows of 5. */
  const ARENA = [
    { name: 'Floor A', rows: 3, seatsPerRow: 10, level: 'Front' },
    { name: 'Floor B', rows: 3, seatsPerRow: 10, level: 'Back' },
    { name: 'Balcony', rows: 2, seatsPerRow: 5, level: 'Upper' },
  ];

  /** Front $95, Back $60, the Balcony off sale (Upper unpriced), and Floor B 3-10 off sale. */
  const arenaEvent = () =>
    seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: [
        { name: 'Front', price: '95.00' },
        { name: 'Back', price: '60.00' },
        { name: 'Upper', price: null },
      ],
      offSale: [{ section: 'Balcony' }, { section: 'Floor B', row: 3, seat: 10 }],
    });

  const map = (eventId: string, client = asAdmin(ctx)) =>
    client.get(`/events/${eventId}/venue-map`);
  const section = (eventId: string, sectionId: string, client = asAdmin(ctx)) =>
    client.get(`/events/${eventId}/venue-map/sections/${sectionId}`);
  const seat = (layout: InsertedLayout, name: string, row: number, s: number) => ({
    sectionId: layout.sections[name],
    row,
    seat: s,
  });

  /**
   * Floor A 1-1 and 1-2 held by customer 1 (one transaction), Floor A 2-1 bought by customer 2 (a
   * hold and an order: two), Floor B 1-2 sold by SQL and then voided (no seat change). seq 3.
   */
  async function trade(eventId: string, layout: InsertedLayout): Promise<void> {
    await (
      await customer(ctx, 1)
    )
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(layout, 'Floor A', 1, 1), seat(layout, 'Floor A', 1, 2)] })
      .expect(201);
    const bought = await reserveThenOrder(
      ctx,
      await tokenFor({ username: 'customer2', roles: ['customer'] }),
      eventId,
      { seats: [seat(layout, 'Floor A', 2, 1)] },
    );
    expect(bought.status).toBe(201);
    const voided = await sellSeats(
      ctx,
      eventId,
      layout,
      [{ section: 'Floor B', row: 1, seat: 2, levelName: 'Back', price: '60.00' }],
      { customer: 3 },
    );
    await ctx.prisma.ticket.updateMany({
      where: { orderId: voided.orderId },
      data: { status: 'VOID' },
    });
  }

  describe('getVenueMap', () => {
    it("gives the layout's drawing, levels with this event's prices, and counts per section and level", async () => {
      const { eventId, layout } = await arenaEvent();
      await trade(eventId, layout);

      const res = await map(eventId).expect(200);

      expect(res.body).toMatchObject({
        eventId,
        seq: 3,
        layoutId: layout.id,
        layoutName: expect.any(String),
        floorKind: 'NONE',
        floorOutline: null,
      });
      expect(res.body.size.width).toBeGreaterThan(0);
      expect(res.body.size.height).toBeGreaterThan(0);
      expect(res.body.levels).toEqual([
        { levelId: layout.levels.Front, name: 'Front', rank: 1, color: 'violet', price: '95.00' },
        { levelId: layout.levels.Back, name: 'Back', rank: 2, color: 'blue', price: '60.00' },
        { levelId: layout.levels.Upper, name: 'Upper', rank: 3, color: 'cyan', price: null },
      ]);
      expect(
        res.body.sections.map((s: { sectionId: string; name: string; counts: unknown }) => ({
          sectionId: s.sectionId,
          name: s.name,
          counts: s.counts,
        })),
      ).toEqual([
        {
          sectionId: layout.sections['Floor A'],
          name: 'Floor A',
          counts: [{ levelId: layout.levels.Front, open: 27, reserved: 2, sold: 1, offSale: 0 }],
        },
        {
          sectionId: layout.sections['Floor B'],
          name: 'Floor B',
          // The void ticket's seat is open.
          counts: [{ levelId: layout.levels.Back, open: 29, reserved: 0, sold: 0, offSale: 1 }],
        },
        {
          sectionId: layout.sections.Balcony,
          name: 'Balcony',
          counts: [{ levelId: layout.levels.Upper, open: 0, reserved: 0, sold: 0, offSale: 10 }],
        },
      ]);
      for (const s of res.body.sections) {
        expect(s.outline.length).toBeGreaterThanOrEqual(3);
        expect(s.labelAt).toHaveLength(2);
      }
    });

    it("counts that add up to each section's seats, whatever the states", async () => {
      const { eventId, layout } = await arenaEvent();
      await trade(eventId, layout);

      const res = await map(eventId).expect(200);

      const total = (s: { counts: Record<string, number>[] }) =>
        s.counts.reduce((n, c) => n + c.open + c.reserved + c.sold + c.offSale, 0);
      expect(res.body.sections.map(total)).toEqual([30, 30, 10]);
    });

    it('gives a level whose seats are all off sale no price, even when the event priced it', async () => {
      const { eventId, layout } = await seatedEvent(ctx, venueId, {
        sections: ARENA,
        levels: [
          { name: 'Front', price: '95.00' },
          { name: 'Back', price: '60.00' },
          { name: 'Upper', price: '20.00' },
        ],
        offSale: [{ section: 'Balcony' }],
      });

      const res = await map(eventId).expect(200);

      expect(res.body.levels.map((l: { price: string | null }) => l.price)).toEqual([
        '95.00',
        '60.00',
        null,
      ]);
      expect(res.body.levels[2].levelId).toBe(layout.levels.Upper);
    });

    it('counts a section by each level its seats resolve to (seat, then row, then section)', async () => {
      const layout = await insertLayout(ctx, venueId, {
        name: 'Split',
        levels: ['Gold', 'Silver', 'Bronze'],
        sections: [
          {
            name: 'S',
            level: 'Bronze',
            rows: 3,
            seatsPerRow: 4,
            rowLevels: { 1: 'Silver' },
            seatLevels: { '1/1': 'Gold', '3/4': 'Gold' },
          },
        ],
      });
      const { eventId } = await seatedEvent(ctx, venueId, {
        layout,
        levels: [
          { name: 'Gold', price: '90.00' },
          { name: 'Silver', price: '50.00' },
          { name: 'Bronze', price: '20.00' },
        ],
      });

      const res = await map(eventId).expect(200);

      expect(res.body.sections[0].counts).toEqual([
        { levelId: layout.levels.Gold, open: 2, reserved: 0, sold: 0, offSale: 0 },
        { levelId: layout.levels.Silver, open: 3, reserved: 0, sold: 0, offSale: 0 },
        { levelId: layout.levels.Bronze, open: 7, reserved: 0, sold: 0, offSale: 0 },
      ]);

      const seats = await section(eventId, layout.sections.S).expect(200);
      const levelOf = (row: number, s: number) =>
        seats.body.rows
          .find((r: { number: number }) => r.number === row)
          .seats.find((x: { number: number }) => x.number === s).levelId;
      expect(levelOf(1, 1)).toBe(layout.levels.Gold);
      expect(levelOf(1, 2)).toBe(layout.levels.Silver);
      expect(levelOf(2, 2)).toBe(layout.levels.Bronze);
      expect(levelOf(3, 4)).toBe(layout.levels.Gold);
    });

    it('moves its seq by one for each change of a seat, and its counts with it', async () => {
      const { eventId, layout } = await arenaEvent();
      const before = await map(eventId).expect(200);
      expect(before.body.seq).toBe(0);

      await (
        await customer(ctx, 1)
      )
        .post(`/events/${eventId}/reservation`)
        .send({ seats: [seat(layout, 'Floor B', 2, 5)] })
        .expect(201);

      const after = await map(eventId).expect(200);
      expect(after.body.seq).toBe(1);
      expect(after.body.sections[1].counts[0]).toMatchObject({ open: 28, reserved: 1 });
    });

    it('is 404 for a general-admission event, saying it has no seat map, and for an unknown event', async () => {
      const ga = await event(ctx, venueId);

      const res = await map(ga).expect(404);
      expect(res.body.error.message).toMatch(/no seat map/i);
      await map('00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  describe('getVenueMapSection', () => {
    it("gives the section's rows front first and each seat's label, place, level and state", async () => {
      const { eventId, layout } = await arenaEvent();
      await trade(eventId, layout);

      const res = await section(eventId, layout.sections['Floor A']).expect(200);

      expect(res.body).toMatchObject({
        eventId,
        seq: 3,
        sectionId: layout.sections['Floor A'],
        name: 'Floor A',
      });
      expect(
        res.body.rows.map((r: { number: number; label: string }) => [r.number, r.label]),
      ).toEqual([
        [1, '1'],
        [2, '2'],
        [3, '3'],
      ]);
      const row1 = res.body.rows[0].seats;
      expect(row1.map((s: { number: number }) => s.number)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(row1[0]).toEqual({
        number: 1,
        label: '1',
        at: expect.any(Array),
        levelId: layout.levels.Front,
        state: 'reserved',
        accessible: false,
      });
      const states = res.body.rows.flatMap((r: { number: number; seats: object[] }) =>
        (r.seats as { number: number; state: string }[]).map(
          (s) => `${r.number}-${s.number}:${s.state}`,
        ),
      );
      expect(states.filter((s: string) => !s.endsWith(':open'))).toEqual([
        '1-1:reserved',
        '1-2:reserved',
        '2-1:sold',
      ]);

      const floorB = await section(eventId, layout.sections['Floor B']).expect(200);
      const b = floorB.body.rows.flatMap((r: { number: number; seats: object[] }) =>
        (r.seats as { number: number; state: string }[]).map(
          (s) => `${r.number}-${s.number}:${s.state}`,
        ),
      );
      expect(b.filter((s: string) => !s.endsWith(':open'))).toEqual(['3-10:offSale']);
    });

    it('is 404 for a section of another layout, of no layout, and for a general-admission event', async () => {
      const { eventId } = await arenaEvent();
      const other = await seatedEvent(ctx, venueId, {
        sections: [{ name: 'Elsewhere', rows: 1, seatsPerRow: 2 }],
      });
      const ga = await event(ctx, venueId, { capacity: 10 });

      await section(eventId, other.layout.sections.Elsewhere).expect(404);
      await section(eventId, '00000000-0000-4000-8000-000000000000').expect(404);
      await section(ga, other.layout.sections.Elsewhere).expect(404);
    });
  });

  describe('privacy and callers (FR-028)', () => {
    it('never names a buyer or holder, and is the same for an admin, a customer and a gate agent', async () => {
      const { eventId, layout } = await arenaEvent();
      await trade(eventId, layout);
      const order = await ctx.prisma.order.findFirstOrThrow({
        where: { eventId, status: 'CONFIRMED' },
      });

      const views = [asAdmin(ctx), await customer(ctx, 4), await agent(ctx)];
      const maps = await Promise.all(views.map((v) => map(eventId, v).expect(200)));
      const sections = await Promise.all(
        views.map((v) => section(eventId, layout.sections['Floor A'], v).expect(200)),
      );

      expect(maps[1].body).toEqual(maps[0].body);
      expect(maps[2].body).toEqual(maps[0].body);
      expect(sections[1].body).toEqual(sections[0].body);
      expect(sections[2].body).toEqual(sections[0].body);
      const all = JSON.stringify([maps[0].body, sections[0].body]);
      for (const secret of [
        subFor('customer1'),
        subFor('customer2'),
        'customer1',
        'customer2',
        order.id,
        HOLDER,
      ]) {
        expect(all).not.toContain(secret);
      }
    });

    it('is 401 without a token, and with an expired, wrongly signed, or wrong-audience token', async () => {
      const { eventId, layout } = await arenaEvent();
      const paths = [
        `/events/${eventId}/venue-map`,
        `/events/${eventId}/venue-map/sections/${layout.sections['Floor A']}`,
      ];
      const bad = [
        await tokenFor({ username: 'customer1', roles: ['customer'], expiresIn: -120 }),
        await tokenFor({ username: 'customer1', roles: ['customer'], rogue: true }),
        await tokenFor({ username: 'customer1', roles: ['customer'], aud: 'some-other-api' }),
      ];
      for (const path of paths) {
        await anon(ctx).get(path).expect(401);
        for (const t of bad) await as(ctx, t).get(path).expect(401);
      }
    });
  });
});
