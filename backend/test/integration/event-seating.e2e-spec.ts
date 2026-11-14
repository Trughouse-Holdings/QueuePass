import type { Response } from 'supertest';
import type { SeatMapChange } from '@queuepass/shared';
import { SeatEventsService } from '../../src/seating/seat-events.service';
import { asAdmin } from '../setup/authed-request';
import {
  event,
  holdSeats,
  layoutRefs,
  sellSeats,
  venue,
  windowAt,
  type InsertedLayout,
} from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { subFor } from '../setup/tokens';

/**
 * Spec 038 US2 (FR-010–FR-015; research R8, R9, R12): an event's layout, a price per level and its
 * seats off sale, saved with the event in `createEvent` and `updateEvent`, all or nothing, and
 * read back with `getEventSeating`. Every response through `asAdmin` is checked against the
 * contract.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 70 seats: Floor A (Front) and Floor B (Back) 3 rows of 10, Balcony (Upper) 2 rows of 5. */
const ARENA = {
  name: 'Arena',
  levels: [
    { name: 'Front', color: 'violet' },
    { name: 'Back', color: 'teal' },
    { name: 'Upper', color: 'blue' },
  ],
  sections: [
    { name: 'Floor A', rows: 3, seatsPerRow: 10, level: 'Front' },
    { name: 'Floor B', rows: 3, seatsPerRow: 10, level: 'Back' },
    { name: 'Balcony', rows: 2, seatsPerRow: 5, level: 'Upper' },
  ],
};
/** 12 seats, another layout of the same venue. */
const CLUB = {
  name: 'Club',
  levels: [{ name: 'Club seats', color: 'orange' }],
  sections: [{ name: 'Club', rows: 2, seatsPerRow: 6, level: 'Club seats' }],
};

/** Where a refusal places itself: `details.field`, else the first entry of `details.fields`. */
const placeOf = (res: Response): string =>
  res.body.error?.details?.field ?? String(res.body.error?.details?.fields?.[0] ?? '');

describe('Event seating: a layout, level prices and seats off sale (038 US2)', () => {
  let ctx: TestContext;
  let venueId: string;
  let arena: InsertedLayout;
  let club: InsertedLayout;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx);
    arena = await makeLayout(venueId, ARENA);
    club = await makeLayout(venueId, CLUB);
  });

  async function makeLayout(locationId: string, lines: Json): Promise<InsertedLayout> {
    const res = await asAdmin(ctx).post(`/locations/${locationId}/layouts`).send(lines).expect(201);
    return layoutRefs(ctx, res.body.id);
  }

  let day = 0;
  const schedule = (over: Json = {}): Json => {
    day += 1;
    return {
      name: 'Cardinals vs. Duke',
      locationId: venueId,
      ...windowAt(500 + day),
      basePrice: '1.00',
      ...over,
    };
  };
  const create = (over: Json = {}) => asAdmin(ctx).post('/events').send(schedule(over));
  const patch = (id: string, body: Json) => asAdmin(ctx).patch(`/events/${id}`).send(body);
  const seating = (id: string) => asAdmin(ctx).get(`/events/${id}/seating`);

  const prices = (layout: InsertedLayout, byName: Record<string, string>) =>
    Object.entries(byName).map(([name, price]) => ({ levelId: layout.levels[name], price }));
  const ARENA_PRICES = { Front: '95.00', Back: '60.00', Upper: '35.00' };

  /** A seated event on Arena with every level priced and nothing off sale. */
  async function seated(over: Json = {}): Promise<string> {
    const res = await create({
      layoutId: arena.id,
      levelPrices: prices(arena, ARENA_PRICES),
      ...over,
    }).expect(201);
    return res.body.id;
  }

  const offSaleIds = async (eventId: string): Promise<string[]> =>
    (await ctx.prisma.eventOffSaleSeat.findMany({ where: { eventId } }))
      .map((o) => o.seatId)
      .sort();
  const priceRows = async (eventId: string): Promise<Record<string, string>> =>
    Object.fromEntries(
      (await ctx.prisma.eventLevelPrice.findMany({ where: { eventId } })).map((p) => [
        p.levelId,
        p.price.toFixed(2),
      ]),
    );
  const sell = (eventId: string, seats: [string, number, number][]) =>
    sellSeats(
      ctx,
      eventId,
      arena,
      seats.map(([section, row, seat]) => ({
        section,
        row,
        seat,
        levelName: section === 'Floor A' ? 'Front' : section === 'Floor B' ? 'Back' : 'Upper',
        price: '60.00',
      })),
    );
  const hold = (eventId: string, section: string, row: number, seat: number) =>
    holdSeats(ctx.prisma, {
      eventId,
      customerSub: subFor('customer2'),
      seats: [{ section, row, seat, seatId: arena.seat(section, row, seat) }],
    });

  describe('createEvent', () => {
    it('schedules a seated event: its layout, prices and seats off sale; capacity and prices from them', async () => {
      const res = await create({
        layoutId: arena.id,
        levelPrices: prices(arena, { Front: '95.00', Back: '60.00' }),
        offSale: [
          { sectionId: arena.sections.Balcony },
          { sectionId: arena.sections['Floor B'], row: 1 },
          { sectionId: arena.sections['Floor B'], row: 2 },
          { sectionId: arena.sections['Floor A'], row: 1, seat: 1 },
          { sectionId: arena.sections['Floor A'], row: 1, seat: 2 },
        ],
      }).expect(201);

      // 70 seats; off sale: Balcony's 10, Floor B's rows 1 and 2 (20), two seats of Floor A.
      expect(res.body).toMatchObject({
        reservedSeating: true,
        layoutId: arena.id,
        totalTicketCapacity: 38,
        basePrice: '60.00',
        priceMax: '95.00',
      });
      const id = res.body.id as string;
      expect(await offSaleIds(id)).toHaveLength(32);
      expect(await offSaleIds(id)).toContain(arena.seat('Floor A', 1, 2));
      expect(await offSaleIds(id)).not.toContain(arena.seat('Floor A', 1, 3));
      expect(await priceRows(id)).toEqual({
        [arena.levels.Front]: '95.00',
        [arena.levels.Back]: '60.00',
      });
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row.seatSeq).toBe(0n);
    });

    it('needs no price for a level whose seats are all off sale, and keeps one sent for it', async () => {
      const res = await create({
        layoutId: arena.id,
        levelPrices: prices(arena, ARENA_PRICES),
        offSale: [{ sectionId: arena.sections.Balcony }],
      }).expect(201);
      // Upper is priced but sells nothing, so the lowest price on sale is Back's.
      expect(res.body).toMatchObject({ basePrice: '60.00', totalTicketCapacity: 60 });
      expect(await priceRows(res.body.id)).toHaveProperty(arena.levels.Upper, '35.00');
    });

    it('refuses a level with seats on sale and no price, naming it, saving nothing', async () => {
      const res = await create({
        layoutId: arena.id,
        levelPrices: prices(arena, { Front: '95.00' }),
        offSale: [{ sectionId: arena.sections['Floor B'], row: 1 }],
      }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.field).toBe('levelPrices');
      expect(res.body.error.message).toMatch(/Back/);
      expect(res.body.error.message).toMatch(/Upper/);
      expect(res.body.error.details.fields[0]).toMatch(/^levelPrices /);
      expect(await ctx.prisma.event.count()).toBe(0);
    });

    it.each([
      [
        'a level of another layout',
        () => ({
          layoutId: arena.id,
          levelPrices: [
            ...prices(arena, ARENA_PRICES),
            { levelId: club.levels['Club seats'], price: '10.00' },
          ],
        }),
        'levelPrices',
      ],
      [
        'a level twice',
        () => ({
          layoutId: arena.id,
          levelPrices: [...prices(arena, ARENA_PRICES), ...prices(arena, { Front: '90.00' })],
        }),
        'levelPrices',
      ],
      [
        'a row the section does not have',
        () => ({
          layoutId: arena.id,
          levelPrices: prices(arena, ARENA_PRICES),
          offSale: [{ sectionId: arena.sections['Floor A'], row: 4 }],
        }),
        'offSale',
      ],
      [
        'a seat the row does not have',
        () => ({
          layoutId: arena.id,
          levelPrices: prices(arena, ARENA_PRICES),
          offSale: [{ sectionId: arena.sections.Balcony, row: 1, seat: 6 }],
        }),
        'offSale',
      ],
      [
        'a section of another layout',
        () => ({
          layoutId: arena.id,
          levelPrices: prices(arena, ARENA_PRICES),
          offSale: [{ sectionId: club.sections.Club }],
        }),
        'offSale',
      ],
      [
        'a seat without its row',
        () => ({
          layoutId: arena.id,
          levelPrices: prices(arena, ARENA_PRICES),
          offSale: [{ sectionId: arena.sections.Balcony, seat: 1 }],
        }),
        'offSale',
      ],
      [
        'ticket types with a layout',
        () => ({
          layoutId: arena.id,
          levelPrices: prices(arena, ARENA_PRICES),
          tiers: [{ name: 'GA', price: '10.00', quantity: 10 }],
        }),
        'tiers',
      ],
      [
        'a ticket capacity with a layout',
        () => ({
          layoutId: arena.id,
          levelPrices: prices(arena, ARENA_PRICES),
          totalTicketCapacity: 70,
        }),
        'totalTicketCapacity',
      ],
      [
        'every seat off sale',
        () => ({
          layoutId: arena.id,
          levelPrices: prices(arena, ARENA_PRICES),
          offSale: Object.values(arena.sections).map((sectionId) => ({ sectionId })),
        }),
        'offSale',
      ],
      [
        'level prices without a layout',
        () => ({ totalTicketCapacity: 50, levelPrices: prices(arena, ARENA_PRICES) }),
        'levelPrices',
      ],
    ] as [string, () => Json, string][])(
      'refuses %s with 400 naming its field',
      async (_l, body, field) => {
        const res = await create(body()).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(placeOf(res).startsWith(field)).toBe(true);
        expect(await ctx.prisma.event.count()).toBe(0);
        expect(await ctx.prisma.eventLevelPrice.count()).toBe(0);
      },
    );

    it('refuses a layout of another venue', async () => {
      const otherVenue = await venue(ctx, 'Freedom Hall');
      const other = await makeLayout(otherVenue, { ...CLUB, name: 'Elsewhere' });
      const res = await create({
        layoutId: other.id,
        levelPrices: prices(other, { 'Club seats': '20.00' }),
      }).expect(400);
      expect(placeOf(res).startsWith('layoutId')).toBe(true);
      expect(await ctx.prisma.event.count()).toBe(0);
    });

    it('refuses a limit per customer above the seats on sale with 409 CAPACITY_EXCEEDED, and accepts one equal', async () => {
      const body = {
        layoutId: club.id,
        levelPrices: prices(club, { 'Club seats': '20.00' }),
        offSale: [{ sectionId: club.sections.Club, row: 1 }],
      };
      const res = await create({ ...body, maxTicketsPerCustomer: 7 }).expect(409);
      expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.details).toMatchObject({
        field: 'maxTicketsPerCustomer',
        seatsOnSale: 6,
        maxTicketsPerCustomer: 7,
      });
      expect(await ctx.prisma.event.count()).toBe(0);
      const ok = await create({ ...body, maxTicketsPerCustomer: 6 }).expect(201);
      expect(ok.body).toMatchObject({ totalTicketCapacity: 6, maxTicketsPerCustomer: 6 });
    });

    it('schedules a general-admission event exactly as before: no layout, no priceMax', async () => {
      const res = await create({ totalTicketCapacity: 50, basePrice: '20.00' }).expect(201);
      expect(res.body).toMatchObject({
        reservedSeating: false,
        layoutId: null,
        priceMax: null,
        basePrice: '20.00',
        totalTicketCapacity: 50,
      });
    });
  });

  describe('updateEvent', () => {
    it('leaves the seating alone when none of the three fields is sent', async () => {
      const id = await seated({ offSale: [{ sectionId: arena.sections.Balcony }] });
      const before = { off: await offSaleIds(id), prices: await priceRows(id) };
      const res = await patch(id, { name: 'Renamed', basePrice: '5.00' }).expect(200);
      expect(res.body).toMatchObject({ layoutId: arena.id, basePrice: '60.00', priceMax: '95.00' });
      expect({ off: await offSaleIds(id), prices: await priceRows(id) }).toEqual(before);
    });

    it('changes the layout of an event with no sales, clearing its prices and seats off sale', async () => {
      const id = await seated({ offSale: [{ sectionId: arena.sections.Balcony }] });
      const res = await patch(id, {
        layoutId: club.id,
        levelPrices: prices(club, { 'Club seats': '20.00' }),
      }).expect(200);
      expect(res.body).toMatchObject({
        layoutId: club.id,
        totalTicketCapacity: 12,
        basePrice: '20.00',
        priceMax: '20.00',
      });
      expect(await offSaleIds(id)).toEqual([]);
      expect(await priceRows(id)).toEqual({ [club.levels['Club seats']]: '20.00' });
    });

    it("saves a new layout's prices and seats off sale sent with it", async () => {
      const id = await seated();
      await patch(id, {
        layoutId: club.id,
        levelPrices: prices(club, { 'Club seats': '20.00' }),
        offSale: [{ sectionId: club.sections.Club, row: 2, seat: 6 }],
      }).expect(200);
      expect(await offSaleIds(id)).toEqual([club.seat('Club', 2, 6)]);
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row.totalTicketCapacity).toBe(11);
    });

    it('refuses a layout change without prices for the new layout', async () => {
      const id = await seated();
      const res = await patch(id, { layoutId: club.id }).expect(400);
      expect(placeOf(res)).toBe('levelPrices');
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row.layoutId).toBe(arena.id);
    });

    it('makes the event general admission with layoutId null, keeping its capacity and base price', async () => {
      const id = await seated({ offSale: [{ sectionId: arena.sections.Balcony }] });
      const res = await patch(id, { layoutId: null }).expect(200);
      expect(res.body).toMatchObject({
        reservedSeating: false,
        layoutId: null,
        priceMax: null,
        totalTicketCapacity: 60,
        basePrice: '60.00',
      });
      expect(await offSaleIds(id)).toEqual([]);
      expect(await priceRows(id)).toEqual({});
      const sent = await seated();
      const typed = await patch(sent, {
        layoutId: null,
        totalTicketCapacity: 50,
        basePrice: '25.00',
      }).expect(200);
      expect(typed.body).toMatchObject({ totalTicketCapacity: 50, basePrice: '25.00' });
    });

    it('puts a general-admission event on a layout', async () => {
      const id = await event(ctx, venueId, { capacity: 50 });
      const res = await patch(id, {
        layoutId: arena.id,
        levelPrices: prices(arena, ARENA_PRICES),
      }).expect(200);
      expect(res.body).toMatchObject({
        reservedSeating: true,
        totalTicketCapacity: 70,
        basePrice: '35.00',
        priceMax: '95.00',
      });
    });

    it('refuses changing or clearing the layout of an event with a valid ticket: 409 EVENT_HAS_ORDERS', async () => {
      const id = await seated();
      await sell(id, [['Floor A', 1, 1]]);
      for (const body of [
        { layoutId: club.id, levelPrices: prices(club, { 'Club seats': '20.00' }) },
        { layoutId: null },
      ]) {
        const res = await patch(id, body).expect(409);
        expect(res.body.error.code).toBe('EVENT_HAS_ORDERS');
        expect(res.body.error.details).toMatchObject({ field: 'layoutId', ticketsSold: 1 });
      }
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row.layoutId).toBe(arena.id);
    });

    it('refuses changing the layout of an event with a live hold', async () => {
      const id = await seated();
      await hold(id, 'Floor B', 2, 3);
      const res = await patch(id, {
        layoutId: club.id,
        levelPrices: prices(club, { 'Club seats': '20.00' }),
      }).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'EVENT_HAS_ORDERS',
        details: { field: 'layoutId' },
      });
    });

    it.each([
      ['by seat', (s: string) => ({ sectionId: s, row: 1, seat: 4 })],
      ['by row', (s: string) => ({ sectionId: s, row: 1 })],
      ['by section', (s: string) => ({ sectionId: s })],
    ])(
      'refuses taking a sold or held seat off sale %s: 409 SEAT_TAKEN naming them',
      async (_l, sel) => {
        const id = await seated();
        await sell(id, [['Floor A', 1, 4]]);
        const res = await patch(id, { offSale: [sel(arena.sections['Floor A'])] }).expect(409);
        expect(res.body.error.code).toBe('SEAT_TAKEN');
        expect(res.body.error.details).toMatchObject({
          field: 'offSale',
          seats: [{ section: 'Floor A', row: 1, seat: 4 }],
        });
        expect(await offSaleIds(id)).toEqual([]);

        const held = await seated();
        await hold(held, 'Floor A', 1, 4);
        const refused = await patch(held, { offSale: [sel(arena.sections['Floor A'])] }).expect(
          409,
        );
        expect(refused.body.error.details.seats).toEqual([{ section: 'Floor A', row: 1, seat: 4 }]);
      },
    );

    it('changes prices of an event with sales, the sold tickets keeping theirs', async () => {
      const id = await seated();
      const { tickets } = await sell(id, [['Floor B', 1, 1]]);
      const res = await patch(id, {
        levelPrices: prices(arena, { Front: '100.00', Back: '70.00', Upper: '40.00' }),
      }).expect(200);
      expect(res.body).toMatchObject({ basePrice: '40.00', priceMax: '100.00' });
      const ticket = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
      expect(ticket.price.toFixed(2)).toBe('60.00');
    });

    it('puts seats back on sale and takes others off, recomputing capacity and prices', async () => {
      const id = await seated({ offSale: [{ sectionId: arena.sections['Floor A'] }] });
      expect(
        (await ctx.prisma.event.findUniqueOrThrow({ where: { id } })).basePrice.toFixed(2),
      ).toBe('35.00');
      const res = await patch(id, {
        offSale: [{ sectionId: arena.sections.Balcony }, { sectionId: arena.sections['Floor B'] }],
      }).expect(200);
      expect(res.body).toMatchObject({
        totalTicketCapacity: 30,
        basePrice: '95.00',
        priceMax: '95.00',
      });
      await patch(id, { offSale: [] }).expect(200);
      expect(await offSaleIds(id)).toEqual([]);
    });

    it('refuses a seating save that leaves the stored limit above the seats on sale', async () => {
      const id = await seated({ maxTicketsPerCustomer: 40 });
      const res = await patch(id, {
        offSale: [
          { sectionId: arena.sections['Floor A'] },
          { sectionId: arena.sections['Floor B'] },
        ],
      }).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CAPACITY_EXCEEDED',
        details: { field: 'offSale', seatsOnSale: 10, maxTicketsPerCustomer: 40 },
      });
      expect(await offSaleIds(id)).toEqual([]);
    });

    it('refuses a ticket capacity or ticket types on a seated event', async () => {
      const id = await seated();
      expect(placeOf(await patch(id, { totalTicketCapacity: 50 }).expect(400))).toMatch(
        /^totalTicketCapacity/,
      );
      expect(
        placeOf(
          await patch(id, { tiers: [{ name: 'GA', price: '1.00', quantity: 1 }] }).expect(400),
        ),
      ).toMatch(/^tiers/);
    });

    it('removes the ticket types of a general-admission event put on a layout', async () => {
      const id = await event(ctx, venueId, { capacity: 50 });
      await asAdmin(ctx)
        .post(`/events/${id}/tiers`)
        .send({ name: 'GA', price: '10.00', quantity: 50 })
        .expect(201);
      await patch(id, { layoutId: arena.id, levelPrices: prices(arena, ARENA_PRICES) }).expect(200);
      expect(await ctx.prisma.ticketTier.count({ where: { eventId: id } })).toBe(0);
    });

    describe('moving to another venue', () => {
      let otherVenue: string;
      let other: InsertedLayout;
      beforeEach(async () => {
        otherVenue = await venue(ctx, 'Freedom Hall');
        // 100 seats, so the event moved without a layout keeps its 70 within the venue.
        other = await makeLayout(otherVenue, {
          ...CLUB,
          name: 'Hall',
          sections: [{ ...CLUB.sections[0], rows: 10, seatsPerRow: 10 }],
        });
      });

      it("takes a layout of the new venue in the same request, not one of the old venue's", async () => {
        const id = await seated();
        const res = await patch(id, {
          locationId: otherVenue,
          layoutId: other.id,
          levelPrices: prices(other, { 'Club seats': '15.00' }),
        }).expect(200);
        expect(res.body).toMatchObject({ locationId: otherVenue, layoutId: other.id });

        const again = await seated();
        const refused = await patch(again, {
          locationId: otherVenue,
          layoutId: club.id,
          levelPrices: prices(club, { 'Club seats': '15.00' }),
        }).expect(400);
        expect(placeOf(refused)).toMatch(/^layoutId/);
        const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id: again } });
        expect(row).toMatchObject({ locationId: venueId, layoutId: arena.id });
      });

      it('clears the layout of an event with no sales moved without one', async () => {
        const id = await seated({ offSale: [{ sectionId: arena.sections.Balcony }] });
        const res = await patch(id, { locationId: otherVenue }).expect(200);
        expect(res.body).toMatchObject({
          locationId: otherVenue,
          layoutId: null,
          reservedSeating: false,
          priceMax: null,
        });
        expect(await offSaleIds(id)).toEqual([]);
        expect(await priceRows(id)).toEqual({});
      });

      it('refuses moving an event with sales: 409 EVENT_HAS_ORDERS', async () => {
        const id = await seated();
        await sell(id, [['Floor A', 2, 2]]);
        const res = await patch(id, { locationId: otherVenue }).expect(409);
        expect(res.body.error).toMatchObject({
          code: 'EVENT_HAS_ORDERS',
          details: { field: 'layoutId' },
        });
      });
    });
  });

  describe('live viewers (R12)', () => {
    /** Every message on the event's bus, and whether it ended. */
    function watch(eventId: string) {
      const seen: SeatMapChange[] = [];
      const state = { ended: false };
      const sub = ctx.app
        .get(SeatEventsService)
        .changes(eventId)
        .subscribe({ next: (m) => seen.push(m), complete: () => (state.ended = true) });
      return { seen, state, stop: () => sub.unsubscribe() };
    }

    it('publishes an off-sale save as seat changes with the next seq, keeping the stream', async () => {
      const id = await seated();
      const w = watch(id);
      await patch(id, { offSale: [{ sectionId: arena.sections.Balcony, row: 1, seat: 2 }] }).expect(
        200,
      );
      await patch(id, { offSale: [{ sectionId: arena.sections.Balcony, row: 1, seat: 3 }] }).expect(
        200,
      );
      expect(w.state.ended).toBe(false);
      expect(w.seen).toEqual([
        {
          eventId: id,
          seq: 1,
          changes: [
            {
              sectionId: arena.sections.Balcony,
              row: 1,
              seat: 2,
              state: 'offSale',
              from: 'open',
              levelId: arena.levels.Upper,
            },
          ],
        },
        {
          eventId: id,
          seq: 2,
          changes: [
            {
              sectionId: arena.sections.Balcony,
              row: 1,
              seat: 3,
              state: 'offSale',
              from: 'open',
              levelId: arena.levels.Upper,
            },
            {
              sectionId: arena.sections.Balcony,
              row: 1,
              seat: 2,
              state: 'open',
              from: 'offSale',
              levelId: arena.levels.Upper,
            },
          ],
        },
      ]);
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row.seatSeq).toBe(2n);
      w.stop();
    });

    it('ends the stream on a price change, and on a layout change', async () => {
      const id = await seated();
      const prices1 = watch(id);
      await patch(id, { levelPrices: prices(arena, { ...ARENA_PRICES, Front: '99.00' }) }).expect(
        200,
      );
      expect(prices1.state.ended).toBe(true);
      const layout1 = watch(id);
      await patch(id, {
        layoutId: club.id,
        levelPrices: prices(club, { 'Club seats': '1.00' }),
      }).expect(200);
      expect(layout1.state.ended).toBe(true);
    });

    it('keeps the stream and the seq on a save that changes no seat or price', async () => {
      const id = await seated();
      const w = watch(id);
      await patch(id, {
        name: 'Renamed',
        levelPrices: prices(arena, ARENA_PRICES),
        offSale: [],
      }).expect(200);
      expect(w.state.ended).toBe(false);
      expect(w.seen).toEqual([]);
      expect((await ctx.prisma.event.findUniqueOrThrow({ where: { id } })).seatSeq).toBe(0n);
      w.stop();
    });
  });

  describe('getEventSeating', () => {
    it('gives the layout, each level with its seats, seats on sale and price, and compacted selectors', async () => {
      // Floor B's row 2, then each of its row 3's seats one by one (a whole row), Balcony's every
      // seat (a whole section), and Floor A, row 1, seats 3 and 4.
      const id = await seated({
        offSale: [
          { sectionId: arena.sections['Floor A'], row: 1, seat: 4 },
          { sectionId: arena.sections['Floor B'], row: 2 },
          ...Array.from({ length: 10 }, (_, i) => ({
            sectionId: arena.sections['Floor B'],
            row: 3,
            seat: i + 1,
          })),
          { sectionId: arena.sections.Balcony, row: 1 },
          { sectionId: arena.sections.Balcony, row: 2 },
          { sectionId: arena.sections['Floor A'], row: 1, seat: 3 },
        ],
      });
      const res = await seating(id).expect(200);
      expect(res.body).toEqual({
        eventId: id,
        layoutId: arena.id,
        levels: [
          {
            levelId: arena.levels.Front,
            name: 'Front',
            rank: 1,
            color: 'violet',
            seatCount: 30,
            seatsOnSale: 28,
            price: '95.00',
          },
          {
            levelId: arena.levels.Back,
            name: 'Back',
            rank: 2,
            color: 'teal',
            seatCount: 30,
            seatsOnSale: 10,
            price: '60.00',
          },
          {
            levelId: arena.levels.Upper,
            name: 'Upper',
            rank: 3,
            color: 'blue',
            seatCount: 10,
            seatsOnSale: 0,
            price: '35.00',
          },
        ],
        offSale: [
          { sectionId: arena.sections.Balcony },
          { sectionId: arena.sections['Floor B'], row: 2 },
          { sectionId: arena.sections['Floor B'], row: 3 },
          { sectionId: arena.sections['Floor A'], row: 1, seat: 3 },
          { sectionId: arena.sections['Floor A'], row: 1, seat: 4 },
        ],
        seatsOnSale: 38,
        seatsOffSale: 32,
      });
    });

    it('gives a null price for a level without one', async () => {
      const id = await seated({
        levelPrices: prices(arena, { Front: '95.00', Back: '60.00' }),
        offSale: [{ sectionId: arena.sections.Balcony }],
      });
      const res = await seating(id).expect(200);
      expect(res.body.levels[2]).toMatchObject({ name: 'Upper', price: null, seatsOnSale: 0 });
    });

    it('gives a general-admission event layoutId null and empty lists', async () => {
      const id = await event(ctx, venueId, { capacity: 50 });
      const res = await seating(id).expect(200);
      expect(res.body).toEqual({
        eventId: id,
        layoutId: null,
        levels: [],
        offSale: [],
        seatsOnSale: 0,
        seatsOffSale: 0,
      });
    });

    it('answers 404 for an unknown event and 400 for an id that is not a UUID', async () => {
      await seating('7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40').expect(404);
      await seating('not-a-uuid').expect(400);
    });
  });

  describe('ticket types and event reads', () => {
    it('refuses a ticket type on a seated event: 400', async () => {
      const id = await seated();
      const res = await asAdmin(ctx)
        .post(`/events/${id}/tiers`)
        .send({ name: 'VIP', price: '100.00', quantity: 5 })
        .expect(400);
      expect(res.body.error.details.fields.join(' ')).toMatch(/seated event has no ticket types/);
      expect(await ctx.prisma.ticketTier.count()).toBe(0);
    });

    it('carries layoutId and priceMax in getEvent and the event list', async () => {
      const id = await seated();
      const ga = await event(ctx, venueId, { capacity: 50 });
      const one = await asAdmin(ctx).get(`/events/${id}`).expect(200);
      expect(one.body).toMatchObject({ layoutId: arena.id, priceMax: '95.00', basePrice: '35.00' });
      const list = (await asAdmin(ctx).get('/events').expect(200)).body as Json[];
      expect(list.find((e) => e.id === id)).toMatchObject({
        layoutId: arena.id,
        priceMax: '95.00',
      });
      expect(list.find((e) => e.id === ga)).toMatchObject({ layoutId: null, priceMax: null });
    });
  });
});
