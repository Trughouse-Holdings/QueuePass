import type { SeatStateChange } from '@queuepass/shared';
import type { Subscription } from 'rxjs';
import { HoldSweeper } from '../../src/reservations/hold-sweeper';
import { SeatEventsService } from '../../src/seating/seat-events.service';
import { asAdmin } from '../setup/authed-request';
import { customer, event, reserveThenOrder, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor, tokenFor } from '../setup/tokens';

/**
 * Spec 015 FR-016 (research R11): admin changes and closed sales end reservations, with `CLOSED`
 * and no 2-minute wait, and tell viewers the seats are open. Removing a tier or the event removes
 * its reservations by cascade instead.
 */
describe('Admin changes end reservations', () => {
  let ctx: TestContext;
  let venueId: string;
  let sectionA: string;
  let sectionB: string;
  let published: SeatStateChange[];
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
    const layout = await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({
        sections: [
          { name: 'A', rows: 3, seatsPerRow: 10 },
          { name: 'B', rows: 2, seatsPerRow: 10 },
        ],
      })
      .expect(200);
    [sectionA, sectionB] = layout.body.sections.map((s: { id: string }) => s.id);
    published = [];
  });

  const seat = (sectionId: string, row: number, s: number) => ({ sectionId, row, seat: s });
  const reserve = async (eventId: string, seats: object[], n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/reservation`)
      .send({ seats })
      .then((r) => {
        expect(r.status).toBe(201);
        return r;
      });
  /** Records what the bus publishes for the event from now on. */
  const listen = (eventId: string) => {
    let completed = false;
    subscription = ctx.app
      .get(SeatEventsService)
      .changes(eventId)
      .subscribe({
        next: (c) => published.push(...c.changes),
        complete: () => (completed = true),
      });
    return { completed: () => completed };
  };
  const opened = () =>
    published
      .filter((c) => c.state === 'open')
      .map(
        (c) =>
          `${c.sectionId === sectionA ? 'A' : c.sectionId === sectionB ? 'B' : '?'}-${c.row}-${c.seat}`,
      )
      .sort();
  const holds = (eventId: string) =>
    ctx.prisma.seatHold.findMany({ where: { eventId }, orderBy: [{ seatSection: 'asc' }] });
  const activeReservations = (eventId: string) =>
    ctx.prisma.seatReservation.count({ where: { eventId, endedAt: null } });

  /** A seated event with VIP in A and General in B. */
  const tiered = async () => {
    const eventId = await event(ctx, venueId, { capacity: 50 });
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 30);
    const general = await tier(ctx, eventId, 'General', '40.00', 20);
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({
        reservedSeating: true,
        sections: [
          { sectionId: sectionA, tierId: vip },
          { sectionId: sectionB, tierId: general },
        ],
      })
      .expect(200);
    return { eventId, vip, general };
  };

  it('cancelEvent ends the holds CLOSED and publishes held and voided seats as open', async () => {
    const { eventId, vip } = await tiered();
    await reserveThenOrder(
      ctx,
      await tokenFor({ username: 'customer2', roles: ['customer'] }),
      eventId,
      {
        tierId: vip,
        seats: [seat(sectionA, 3, 3)],
      },
    ).then((r) => expect(r.status).toBe(201));
    await reserve(eventId, [seat(sectionA, 1, 1), seat(sectionA, 1, 2)]);
    listen(eventId);

    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const live = (await holds(eventId)).filter((h) => h.endReason !== 'BOUGHT');
    expect(live.map((h) => h.endReason)).toEqual(['CLOSED', 'CLOSED']);
    expect(await activeReservations(eventId)).toBe(0);
    expect(opened()).toEqual(['A-1-1', 'A-1-2', 'A-3-3']);
  });

  it('updateSeating turning reserved seating off ends every hold, without the 2-minute wait', async () => {
    const eventId = await event(ctx, venueId, { capacity: 50 });
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
    await reserve(eventId, [seat(sectionA, 1, 1)]);
    listen(eventId);

    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: false, sections: [] })
      .expect(200);

    expect((await holds(eventId)).map((h) => h.endReason)).toEqual(['CLOSED']);
    expect(opened()).toEqual(['A-1-1']);

    // Back on: the same customer may reserve the seat at once (no wait after CLOSED).
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
    await reserve(eventId, [seat(sectionA, 1, 1)]);
  });

  it("updateSeating moving one section to another tier ends only that section's holds", async () => {
    const { eventId, vip, general } = await tiered();
    await reserve(eventId, [seat(sectionA, 1, 1)], 1);
    await reserve(eventId, [seat(sectionB, 1, 1)], 2);
    listen(eventId);

    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({
        reservedSeating: true,
        sections: [
          { sectionId: sectionA, tierId: vip },
          { sectionId: sectionB, tierId: vip },
        ],
      })
      .expect(200);

    const after = await holds(eventId);
    expect(after.map((h) => [h.seatSection, h.endReason])).toEqual([
      ['A', null],
      ['B', 'CLOSED'],
    ]);
    expect(opened()).toEqual(['B-1-1']);
    expect(general).toBeDefined();
    // Customer 2 may reserve B-1-1 again at once, now as VIP.
    const again = await reserve(eventId, [seat(sectionB, 1, 1)], 2);
    expect(again.body.tierId).toBe(vip);
  });

  it("replaceLayout ends every hold at the venue's events", async () => {
    const first = await event(ctx, venueId, { capacity: 50 });
    const second = await event(ctx, venueId, { capacity: 50 });
    for (const id of [first, second]) {
      await asAdmin(ctx)
        .put(`/events/${id}/seating`)
        .send({ reservedSeating: true, sections: [] })
        .expect(200);
    }
    await reserve(first, [seat(sectionA, 1, 1)]);
    await reserve(second, [seat(sectionB, 2, 2)]);
    listen(first);

    await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({ sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }] })
      .expect(200);

    expect((await holds(first)).map((h) => h.endReason)).toEqual(['CLOSED']);
    expect((await holds(second)).map((h) => h.endReason)).toEqual(['CLOSED']);
    // Published by the old layout's section ids, the ones viewers have.
    expect(opened()).toEqual(['A-1-1']);
  });

  it('createTicketTier adding the first tier ends tierless reservations', async () => {
    const eventId = await event(ctx, venueId, { capacity: 50 });
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
    await reserve(eventId, [seat(sectionA, 2, 2)]);
    listen(eventId);

    // A seated event's tier takes no quantity: it follows its sections (spec 007 FR-006).
    await asAdmin(ctx)
      .post(`/events/${eventId}/tiers`)
      .send({ name: 'VIP', price: '120.00' })
      .expect(201);

    expect((await holds(eventId)).map((h) => h.endReason)).toEqual(['CLOSED']);
    expect(await activeReservations(eventId)).toBe(0);
    expect(opened()).toEqual(['A-2-2']);
  });

  it('the sweep ends every hold once the event has started', async () => {
    const { eventId } = await tiered();
    await reserve(eventId, [seat(sectionA, 1, 4)]);
    await ctx.prisma.$executeRaw`
      UPDATE "Event" SET "startsAt" = now() - interval '1 minute' WHERE "id" = ${eventId}::uuid`;
    listen(eventId);

    await ctx.app.get(HoldSweeper).sweepOnce();

    expect((await holds(eventId)).map((h) => h.endReason)).toEqual(['CLOSED']);
    expect(opened()).toEqual(['A-1-4']);
  });

  it("deleteTicketTier removes the tier's reservations and publishes their seats as open", async () => {
    const { eventId, general } = await tiered();
    await reserve(eventId, [seat(sectionB, 1, 1), seat(sectionB, 1, 2)]);
    await reserve(eventId, [seat(sectionA, 1, 1)], 2);
    listen(eventId);

    await asAdmin(ctx).delete(`/events/${eventId}/tiers/${general}`).expect(204);

    const left = await holds(eventId);
    expect(left.map((h) => h.seatSection)).toEqual(['A']);
    expect(
      await ctx.prisma.seatReservation.count({ where: { customerSub: subFor('customer1') } }),
    ).toBe(0);
    expect(opened()).toEqual(['B-1-1', 'B-1-2']);
  });

  it('deleteEvent removes its reservations and completes its streams', async () => {
    const eventId = await event(ctx, venueId, { capacity: 50 });
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
    await reserve(eventId, [seat(sectionA, 1, 1)]);
    const stream = listen(eventId);

    await asAdmin(ctx).delete(`/events/${eventId}`).expect(204);

    expect(await ctx.prisma.seatReservation.count()).toBe(0);
    expect(await ctx.prisma.seatHold.count()).toBe(0);
    expect(stream.completed()).toBe(true);
  });
});
