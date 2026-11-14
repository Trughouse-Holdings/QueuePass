import type { SeatMapChange, SeatStateChange } from '@queuepass/shared';
import type { Subscription } from 'rxjs';
import { HoldSweeper } from '../../src/reservations/hold-sweeper';
import { SeatEventsService } from '../../src/seating/seat-events.service';
import { asAdmin } from '../setup/authed-request';
import {
  customer,
  endEventAt,
  reserveThenOrder,
  seatedEvent,
  seatedLayout,
  venue,
  type InsertedLayout,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 015 FR-016 (research R11): admin changes and closed sales end reservations, with `CLOSED`
 * and no 2-minute wait, and tell viewers the seats are open. Removing the event removes its
 * reservations by cascade instead.
 *
 * Spec 038 (research R7, R8, R12): an event's seating and its layout are no longer changed under
 * live holds. Clearing or changing the layout is `409 EVENT_HAS_ORDERS`, taking a held seat off
 * sale `409 SEAT_TAKEN`, a lines edit of the layout `409 LAYOUT_IN_USE`, a ticket type on a seated
 * event `400`; each keeps every hold. A price change keeps the holds, publishes no seat and ends
 * the event's streams. Every published change carries its `seq`, `from` and `levelId`.
 */
describe('Admin changes and reservations', () => {
  let ctx: TestContext;
  let venueId: string;
  let layout: InsertedLayout;
  let messages: SeatMapChange[];
  let subscription: Subscription | undefined;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  afterEach(() => subscription?.unsubscribe());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Seat Hall');
    layout = await seatedLayout(
      ctx,
      venueId,
      [
        { name: 'A', rows: 3, seatsPerRow: 10, level: 'VIP' },
        { name: 'B', rows: 2, seatsPerRow: 10, level: 'General' },
      ],
      ['VIP', 'General'],
    );
    messages = [];
  });

  const PRICES = [
    { name: 'VIP', price: '120.00' },
    { name: 'General', price: '40.00' },
  ];
  /** A seated event on the layout: VIP $120 in A, General $40 in B. */
  const seated = async () => (await seatedEvent(ctx, venueId, { layout, levels: PRICES })).eventId;

  const seat = (section: 'A' | 'B', row: number, s: number) => ({
    sectionId: layout.sections[section],
    row,
    seat: s,
  });
  const reserve = async (eventId: string, seats: object[], n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/reservation`)
      .send({ seats })
      .then((r) => {
        expect([200, 201]).toContain(r.status);
        return r;
      });
  /** Records what the bus publishes for the event from now on. */
  const listen = (eventId: string) => {
    let completed = false;
    subscription = ctx.app
      .get(SeatEventsService)
      .changes(eventId)
      .subscribe({
        next: (c) => messages.push(c),
        complete: () => (completed = true),
      });
    return { completed: () => completed };
  };
  const published = (): SeatStateChange[] => messages.flatMap((m) => m.changes);
  const opened = () =>
    published()
      .filter((c) => c.state === 'open')
      .map(
        (c) =>
          `${c.sectionId === layout.sections.A ? 'A' : c.sectionId === layout.sections.B ? 'B' : '?'}-${c.row}-${c.seat}`,
      )
      .sort();
  const holds = (eventId: string) =>
    ctx.prisma.seatHold.findMany({
      where: { eventId },
      orderBy: [{ seatSection: 'asc' }, { seatRow: 'asc' }, { seatNumber: 'asc' }],
    });
  const activeReservations = (eventId: string) =>
    ctx.prisma.seatReservation.count({ where: { eventId, endedAt: null } });
  const seatSeq = async (eventId: string) =>
    Number((await ctx.prisma.event.findUniqueOrThrow({ where: { id: eventId } })).seatSeq);

  it('cancelEvent ends the holds CLOSED and publishes held and voided seats as open, in one seq', async () => {
    const eventId = await seated();
    await reserveThenOrder(
      ctx,
      await tokenFor({ username: 'customer2', roles: ['customer'] }),
      eventId,
      { seats: [seat('A', 3, 3)] },
    ).then((r) => expect(r.status).toBe(201));
    await reserve(eventId, [seat('A', 1, 1), seat('A', 1, 2)]);
    const before = await seatSeq(eventId);
    listen(eventId);

    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const live = (await holds(eventId)).filter((h) => h.endReason !== 'BOUGHT');
    expect(live.map((h) => h.endReason)).toEqual(['CLOSED', 'CLOSED']);
    expect(await activeReservations(eventId)).toBe(0);
    expect(opened()).toEqual(['A-1-1', 'A-1-2', 'A-3-3']);
    expect(messages.map((m) => m.seq)).toEqual([before + 1]);
    const vip = layout.levels.VIP;
    expect(published()).toEqual(
      expect.arrayContaining([
        { ...seat('A', 1, 1), state: 'open', from: 'reserved', levelId: vip },
        { ...seat('A', 3, 3), state: 'open', from: 'sold', levelId: vip },
      ]),
    );
  });

  it('refuses to clear or change the layout while seats are held (409 EVENT_HAS_ORDERS), keeping the holds', async () => {
    const eventId = await seated();
    await reserve(eventId, [seat('A', 1, 1)]);
    const other = await seatedLayout(ctx, venueId, [{ name: 'Club', rows: 1, seatsPerRow: 4 }]);
    const stream = listen(eventId);

    const cleared = await asAdmin(ctx).patch(`/events/${eventId}`).send({ layoutId: null });
    const moved = await asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({
        layoutId: other.id,
        levelPrices: [{ levelId: other.levels.Standard, price: '10.00' }],
      });

    for (const res of [cleared, moved]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EVENT_HAS_ORDERS');
    }
    expect((await holds(eventId)).map((h) => h.endReason)).toEqual([null]);
    expect(published()).toEqual([]);
    expect(stream.completed()).toBe(false);
  });

  it('refuses to take a held seat off sale, by seat, row or section (409 SEAT_TAKEN), keeping the hold', async () => {
    const eventId = await seated();
    await reserve(eventId, [seat('B', 1, 1)], 2);
    listen(eventId);

    for (const offSale of [
      [seat('B', 1, 1)],
      [{ sectionId: layout.sections.B, row: 1 }],
      [{ sectionId: layout.sections.B }],
    ]) {
      const res = await asAdmin(ctx).patch(`/events/${eventId}`).send({ offSale });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SEAT_TAKEN');
    }
    expect((await holds(eventId)).map((h) => [h.seatSection, h.endReason])).toEqual([['B', null]]);
    expect(published()).toEqual([]);
  });

  it('keeps every hold through a price change, publishing no seat and ending the streams', async () => {
    const eventId = await seated();
    await reserve(eventId, [seat('A', 1, 1)], 1);
    await reserve(eventId, [seat('B', 1, 1)], 2);
    const stream = listen(eventId);

    await asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({
        levelPrices: [
          { levelId: layout.levels.VIP, price: '150.00' },
          { levelId: layout.levels.General, price: '40.00' },
        ],
      })
      .expect(200);

    expect((await holds(eventId)).map((h) => [h.seatSection, h.endReason])).toEqual([
      ['A', null],
      ['B', null],
    ]);
    expect(published()).toEqual([]);
    // Research R12: the map's prices changed, so viewers reconnect and read it again.
    expect(stream.completed()).toBe(true);
    const mine = await (await customer(ctx, 1)).get('/me/reservations').expect(200);
    expect(mine.body[0].seats[0]).toMatchObject({ levelName: 'VIP', price: '150.00' });
  });

  it("refuses a lines edit of the layout while an event's seat is held (409 LAYOUT_IN_USE), keeping the holds", async () => {
    const first = await seated();
    const second = await seated();
    await reserve(first, [seat('A', 1, 1)]);
    await reserve(second, [seat('B', 2, 2)]);
    const stream = listen(first);

    const res = await asAdmin(ctx)
      .put(`/layouts/${layout.id}`)
      .send({
        levels: [{ name: 'VIP', color: 'violet' }],
        sections: [{ name: 'A', rows: 3, seatsPerRow: 10, level: 'VIP' }],
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAYOUT_IN_USE');
    expect((await holds(first)).map((h) => h.endReason)).toEqual([null]);
    expect((await holds(second)).map((h) => h.endReason)).toEqual([null]);
    expect(published()).toEqual([]);
    expect(stream.completed()).toBe(false);
  });

  it('refuses a ticket type on a seated event (400), keeping the holds', async () => {
    const eventId = await seated();
    await reserve(eventId, [seat('A', 2, 2)]);
    listen(eventId);

    await asAdmin(ctx)
      .post(`/events/${eventId}/tiers`)
      .send({ name: 'VIP', price: '120.00', quantity: 10 })
      .expect(400);

    expect((await holds(eventId)).map((h) => h.endReason)).toEqual([null]);
    expect(await activeReservations(eventId)).toBe(1);
    expect(published()).toEqual([]);
  });

  // Spec 034 FR-004, SC-003 (research R3): the sweep leaves a started event's holds alone and
  // ends them at its end, without shortening expiresAt.
  it('the sweep keeps the holds of an event that has started but not ended', async () => {
    const eventId = await seated();
    await reserve(eventId, [seat('A', 1, 4)]);
    await ctx.prisma.$executeRaw`
      UPDATE "Event"
      SET "doorsOpenAt" = "doorsOpenAt" + (now() - interval '1 minute' - "startsAt"),
          "startsAt" = now() - interval '1 minute'
      WHERE "id" = ${eventId}::uuid`;
    const before = await seatSeq(eventId);
    listen(eventId);

    await ctx.app.get(HoldSweeper).sweepOnce();

    expect(await activeReservations(eventId)).toBe(1);
    expect((await holds(eventId)).map((h) => h.endReason)).toEqual([null]);
    expect(opened()).toEqual([]);
    expect(await seatSeq(eventId)).toBe(before);
  });

  it('the sweep ends every hold once the event has ended', async () => {
    const eventId = await seated();
    const made = await reserve(eventId, [seat('A', 1, 4)]);
    // Past its end by a minute: the sweep reads the database's clock (research R1).
    await endEventAt(ctx, eventId, new Date(Date.now() - 60_000));
    const before = await seatSeq(eventId);
    listen(eventId);

    await ctx.app.get(HoldSweeper).sweepOnce();

    expect((await holds(eventId)).map((h) => h.endReason)).toEqual(['CLOSED']);
    const reservation = await ctx.prisma.seatReservation.findFirstOrThrow({ where: { eventId } });
    expect(reservation.endedAt).not.toBeNull();
    expect(reservation.expiresAt.getTime()).toBe(Date.parse(made.body.expiresAt));
    expect(opened()).toEqual(['A-1-4']);
    expect(messages.map((m) => m.seq)).toEqual([before + 1]);
  });

  it('deleteEvent removes its reservations and completes its streams', async () => {
    const eventId = await seated();
    await reserve(eventId, [seat('A', 1, 1)]);
    const stream = listen(eventId);

    await asAdmin(ctx).delete(`/events/${eventId}`).expect(204);

    expect(await ctx.prisma.seatReservation.count()).toBe(0);
    expect(await ctx.prisma.seatHold.count()).toBe(0);
    expect(stream.completed()).toBe(true);
  });
});
