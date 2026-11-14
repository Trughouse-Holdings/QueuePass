import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { customer, insertLayout, seatedEvent, venue, type InsertedLayout } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 038 US3 (FR-021, research R10): one reservation holds seats of any levels of an event, still
 * at most 10; it has no ticket type (`tierId` null); each reserved seat says its labels, level and
 * the level's current price. A seat off sale is `409 SEAT_OFF_SALE`; a seat the layout does not
 * have is `400`. The `016` limit and `033`'s 2-minute wait are unchanged. Every response through
 * the request helpers is checked against the contract.
 */
describe('Holds across price levels (038 US3)', () => {
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
    venueId = await venue(ctx, 'Level Hall');
  });

  const ARENA = [
    { name: 'Floor A', rows: 3, seatsPerRow: 10, level: 'Front' },
    { name: 'Floor B', rows: 3, seatsPerRow: 10, level: 'Back' },
    { name: 'Balcony', rows: 2, seatsPerRow: 5, level: 'Upper' },
  ];
  const PRICED = [
    { name: 'Front', price: '95.00' },
    { name: 'Back', price: '60.00' },
    { name: 'Upper', price: '35.00' },
  ];

  const code = (res: Response): string => res.body.error?.code;
  const seat = (layout: InsertedLayout, name: string, row: number, s: number) => ({
    sectionId: layout.sections[name],
    row,
    seat: s,
  });
  const reserve = async (eventId: string, seats: object[], n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation`).send({ seats });
  const release = async (eventId: string, n = 1) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation/release`).send();
  const liveHolds = (eventId: string) =>
    ctx.prisma.seatHold.count({ where: { eventId, releasedAt: null } });

  it('holds seats of three levels in one reservation, with no ticket type', async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });

    const res = await reserve(eventId, [
      seat(layout, 'Balcony', 1, 1),
      seat(layout, 'Floor A', 2, 7),
      seat(layout, 'Floor B', 3, 4),
    ]);

    expect(res.status).toBe(201);
    expect(res.body.tierId).toBeNull();
    expect(res.body.seats).toEqual([
      {
        sectionId: layout.sections['Floor A'],
        section: 'Floor A',
        row: 2,
        seat: 7,
        rowLabel: '2',
        seatLabel: '7',
        levelName: 'Front',
        price: '95.00',
      },
      {
        sectionId: layout.sections['Floor B'],
        section: 'Floor B',
        row: 3,
        seat: 4,
        rowLabel: '3',
        seatLabel: '4',
        levelName: 'Back',
        price: '60.00',
      },
      {
        sectionId: layout.sections.Balcony,
        section: 'Balcony',
        row: 1,
        seat: 1,
        rowLabel: '1',
        seatLabel: '1',
        levelName: 'Upper',
        price: '35.00',
      },
    ]);
    const reservation = await ctx.prisma.seatReservation.findFirstOrThrow({ where: { eventId } });
    expect(reservation.tierId).toBeNull();
    // Each hold keeps its seat itself (FR-025).
    const holds = await ctx.prisma.seatHold.findMany({ where: { eventId } });
    expect(holds.map((h) => h.seatId).sort()).toEqual(
      [
        layout.seat('Balcony', 1, 1),
        layout.seat('Floor A', 2, 7),
        layout.seat('Floor B', 3, 4),
      ].sort(),
    );
  });

  it('still holds at most 10 seats, of any levels (400 at 11)', async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });
    const ten = [
      ...[1, 2, 3, 4].map((s) => seat(layout, 'Floor A', 1, s)),
      ...[1, 2, 3].map((s) => seat(layout, 'Floor B', 1, s)),
      ...[1, 2, 3].map((s) => seat(layout, 'Balcony', 1, s)),
    ];

    expect((await reserve(eventId, ten.slice(0, 5))).status).toBe(201);
    expect((await reserve(eventId, ten.slice(5))).status).toBe(200);
    const eleventh = await reserve(eventId, [seat(layout, 'Balcony', 2, 1)]);

    expect(eleventh.status).toBe(400);
    expect(await liveHolds(eventId)).toBe(10);
  });

  it("gives each seat its level's current price, which follows a price change while held", async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });
    await reserve(eventId, [seat(layout, 'Floor A', 1, 1)]);

    await asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({
        levelPrices: [
          { levelId: layout.levels.Front, price: '99.50' },
          { levelId: layout.levels.Back, price: '60.00' },
          { levelId: layout.levels.Upper, price: '35.00' },
        ],
      })
      .expect(200);

    const mine = await (await customer(ctx, 1)).get('/me/reservations').expect(200);
    expect(mine.body[0].seats[0]).toMatchObject({ levelName: 'Front', price: '99.50' });
  });

  it('shows the labels people read, not the numbers, when they differ', async () => {
    // insertLayout labels rows A, B, C…
    const layout = await insertLayout(ctx, venueId, {
      name: 'Lettered',
      levels: ['Club'],
      sections: [{ name: '115', level: 'Club', rows: 6, seatsPerRow: 8 }],
    });
    const { eventId } = await seatedEvent(ctx, venueId, {
      layout,
      levels: [{ name: 'Club', price: '80.00' }],
    });

    const res = await reserve(eventId, [seat(layout, '115', 6, 7)]);

    expect(res.status).toBe(201);
    expect(res.body.seats[0]).toMatchObject({
      section: '115',
      row: 6,
      seat: 7,
      rowLabel: 'F',
      seatLabel: '7',
      levelName: 'Club',
      price: '80.00',
    });
  });

  it('refuses a seat off sale with 409 SEAT_OFF_SALE naming it, holding nothing', async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: [
        { name: 'Front', price: '95.00' },
        { name: 'Back', price: '60.00' },
        { name: 'Upper', price: null },
      ],
      offSale: [{ section: 'Balcony' }, { section: 'Floor A', row: 1, seat: 3 }],
    });

    for (const off of [seat(layout, 'Floor A', 1, 3), seat(layout, 'Balcony', 2, 5)]) {
      const res = await reserve(eventId, [seat(layout, 'Floor A', 1, 2), off]);

      expect(res.status).toBe(409);
      expect(code(res)).toBe('SEAT_OFF_SALE');
      expect(res.body.error.details.seats).toEqual([off]);
      expect(await liveHolds(eventId)).toBe(0);
    }
  });

  it('refuses a seat the layout does not have (400)', async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });

    for (const bad of [
      seat(layout, 'Floor A', 4, 1),
      seat(layout, 'Floor A', 1, 11),
      seat(layout, 'Balcony', 1, 6),
    ]) {
      const res = await reserve(eventId, [bad]);
      expect(res.status).toBe(400);
    }
    expect(await liveHolds(eventId)).toBe(0);
  });

  it("keeps 016's limit, counting seats of every level", async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
      maxTicketsPerCustomer: 2,
    });

    const res = await reserve(eventId, [
      seat(layout, 'Floor A', 1, 1),
      seat(layout, 'Floor B', 1, 1),
      seat(layout, 'Balcony', 1, 1),
    ]);

    expect(res.status).toBe(409);
    expect(code(res)).toBe('TICKET_LIMIT_REACHED');
    expect(res.body.error.details).toMatchObject({ limit: 2, requested: 3 });
  });

  it("keeps 033's 2-minute wait on seats of a reservation that ended", async () => {
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: ARENA,
      levels: PRICED,
    });
    await reserve(eventId, [seat(layout, 'Floor A', 1, 1), seat(layout, 'Floor B', 1, 1)]);
    await release(eventId);

    const again = await reserve(eventId, [seat(layout, 'Floor B', 1, 1)]);

    expect(again.status).toBe(409);
    expect(code(again)).toBe('SEAT_COOLDOWN');
    expect(again.body.error.details.seats).toEqual([{ section: 'Floor B', row: 1, seat: 1 }]);
    // Another customer may take it at once.
    expect((await reserve(eventId, [seat(layout, 'Floor B', 1, 1)], 2)).status).toBe(201);
  });
});
