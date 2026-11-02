import { EntryService } from '../../src/entry/entry.service';
import { asAdmin } from '../setup/authed-request';
import { agent, atInstant, eventAroundNow, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 017 US3 (FR-011, FR-019; research R5), spec 025 FR-011 (research R7): the entry window
 * `[doorsOpenAt - 1h, endsAt)` (`[startsAt - 2h, endsAt)` for the default doors, 1 hour before) on the
 * database's clock, tested on both sides of both boundaries with 30-second margins (Constitution
 * VI), and the order of reasons when several apply.
 */
describe('Entry window and the order of reasons', () => {
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
    venueId = await venue(ctx);
  });

  const lookup = async (eventId: string, code: string) =>
    (await agent(ctx)).post(`/events/${eventId}/entry/lookup`).send({ code });
  const admit = async (eventId: string, ticketId: string) =>
    (await agent(ctx)).post(`/events/${eventId}/entry/admit`).send({ ticketId, wholeOrder: false });

  it('default doors, starting in 2 hours 30 seconds: NOT_OPEN, with entryOpensAt, for lookup and admit', async () => {
    const eventId = await eventAroundNow(ctx, venueId, {
      startsInSeconds: 2 * 3600 + 30,
      lastsSeconds: 3600,
    });
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });

    const look = await lookup(eventId, tickets[0].code);
    expect(look.status).toBe(200);
    expect(look.body.state).toBe('NOT_OPEN');
    expect(look.body.entryOpensAt).toEqual(expect.any(String));

    const refused = await admit(eventId, tickets[0].id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('NOT_OPEN');
    expect(refused.body.error.details.entryOpensAt).toEqual(expect.any(String));
  });

  it('default doors, starting in 1 hour 59 minutes 30 seconds: ADMITTABLE, and admits', async () => {
    const eventId = await eventAroundNow(ctx, venueId, {
      startsInSeconds: 2 * 3600 - 30,
      lastsSeconds: 3600,
    });
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    expect((await lookup(eventId, tickets[0].code)).body.state).toBe('ADMITTABLE');
    expect((await admit(eventId, tickets[0].id)).status).toBe(200);
  });

  it('admits when the window opens between the UPDATE and its re-read: the one retry', async () => {
    // The admit's UPDATE misses while the event is NOT_OPEN; the event then moves a minute
    // earlier, doors too, just before the re-read (FR-019, research R5), as the clock would at the
    // boundary. The re-read says ADMITTABLE, so the admit tries once more and records the entry.
    const eventId = await eventAroundNow(ctx, venueId, {
      startsInSeconds: 2 * 3600 + 30,
      lastsSeconds: 3600,
    });
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const service = ctx.app.get(EntryService) as unknown as {
      select: (...args: unknown[]) => Promise<unknown>;
      tryAdmit: (...args: unknown[]) => Promise<unknown>;
    };
    const realSelect = service.select.bind(service);
    const select = jest.spyOn(service, 'select').mockImplementationOnce(async (...args) => {
      await ctx.prisma.$executeRaw`
        UPDATE "Event"
        SET "startsAt" = "startsAt" - interval '1 minute', "endsAt" = "endsAt" - interval '1 minute',
            "doorsOpenAt" = "doorsOpenAt" - interval '1 minute'
        WHERE "id" = ${eventId}::uuid`;
      return realSelect(...args);
    });
    const tryAdmit = jest.spyOn(service, 'tryAdmit');
    try {
      const res = await admit(eventId, tickets[0].id);
      expect(res.status).toBe(200);
      expect(res.body.admitted.map((t: { ticketId: string }) => t.ticketId)).toEqual([
        tickets[0].id,
      ]);
      // Missed once, re-read once, admitted on the retry.
      expect(tryAdmit).toHaveBeenCalledTimes(2);
      expect(select).toHaveBeenCalledTimes(1);
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
      expect(row.checkedInAt).not.toBeNull();
    } finally {
      select.mockRestore();
      tryAdmit.mockRestore();
    }
  });

  it('ending in 30 seconds still admits', async () => {
    const eventId = await eventAroundNow(ctx, venueId, {
      startsInSeconds: -3600,
      lastsSeconds: 3600 + 30,
    });
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    expect((await admit(eventId, tickets[0].id)).status).toBe(200);
  });

  it('ended 30 seconds ago is ENDED for both operations', async () => {
    const eventId = await eventAroundNow(ctx, venueId, {
      startsInSeconds: -3600,
      lastsSeconds: 3600 - 30,
    });
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    expect((await lookup(eventId, tickets[0].code)).body.state).toBe('ENDED');
    const refused = await admit(eventId, tickets[0].id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('ENDED');
  });

  // Spec 025 FR-011 to FR-013 (research R7): the window opens 1 hour before doors open, whatever
  // the gap between doors and start, 30 seconds either side, for the lookup and the admit.
  describe.each([
    ['doors at the start', 0],
    ['doors 180 minutes before the start', 3 * 3600],
  ])('%s', (_label, doorsBefore) => {
    const opensIn = (seconds: number) =>
      eventAroundNow(ctx, venueId, {
        // Entry opens doorsBefore + 1 hour before the start.
        startsInSeconds: doorsBefore + 3600 + seconds,
        lastsSeconds: 3600,
        doorsBeforeStartSeconds: doorsBefore,
      });
    const entryOpensAt = async (eventId: string) =>
      (await ctx.prisma.event.findUniqueOrThrow({ where: { id: eventId } })).doorsOpenAt.getTime() -
      3600 * 1000;

    it('30 seconds before 1 hour before doors open: NOT_OPEN for lookup and admit, nothing recorded', async () => {
      const eventId = await opensIn(30);
      const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
      const look = await lookup(eventId, tickets[0].code);
      expect(look.body.state).toBe('NOT_OPEN');
      expect(new Date(look.body.entryOpensAt).getTime()).toBe(await entryOpensAt(eventId));
      const refused = await admit(eventId, tickets[0].id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.details.reason).toBe('NOT_OPEN');
      expect(new Date(refused.body.error.details.entryOpensAt).getTime()).toBe(
        await entryOpensAt(eventId),
      );
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
      expect(row.checkedInAt).toBeNull();
    });

    it('30 seconds after: ADMITTABLE, and admits', async () => {
      const eventId = await opensIn(-30);
      const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
      expect((await lookup(eventId, tickets[0].code)).body.state).toBe('ADMITTABLE');
      expect((await admit(eventId, tickets[0].id)).status).toBe(200);
    });
  });

  it('doors moved 2 hours later while open: the next lookup is NOT_OPEN at the new time; an entry stays (FR-013)', async () => {
    // Starts in 3 hours with doors now: entry opened an hour ago.
    const eventId = await eventAroundNow(ctx, venueId, {
      startsInSeconds: 3 * 3600,
      lastsSeconds: 3600,
      doorsBeforeStartSeconds: 3 * 3600,
    });
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 2 });
    expect((await admit(eventId, tickets[0].id)).status).toBe(200);

    const before = await ctx.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    // Whole seconds: an event time is sent to the second.
    const later = new Date(
      Math.floor(before.doorsOpenAt.getTime() / 1000) * 1000 + 2 * 3600 * 1000,
    );
    await asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({ doorsOpenAt: atInstant(later) })
      .expect(200);

    const look = await lookup(eventId, tickets[1].code);
    expect(look.body.state).toBe('NOT_OPEN');
    expect(new Date(look.body.entryOpensAt).getTime()).toBe(later.getTime() - 3600 * 1000);
    const admitted = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(admitted.checkedInAt).not.toBeNull();
    expect((await lookup(eventId, tickets[0].code)).body.state).toBe('USED');
  });

  describe('order of reasons (research R5)', () => {
    it("a used ticket of another event is OTHER_EVENT, naming the ticket's event", async () => {
      const gate = await eventAroundNow(ctx, venueId, {
        startsInSeconds: 3600,
        lastsSeconds: 10800,
        name: 'This Gate',
      });
      // Its own venue: two open events can't share one (spec 002's event_no_overlap).
      const other = await eventAroundNow(ctx, await venue(ctx, 'Other Hall'), {
        startsInSeconds: 3600,
        lastsSeconds: 10800,
        name: 'Other Show',
      });
      const { tickets } = await orderWithTickets(ctx, other, { quantity: 1 });
      await admit(other, tickets[0].id).then((r) => expect(r.status).toBe(200));

      const look = await lookup(gate, tickets[0].code);
      expect(look.body.state).toBe('OTHER_EVENT');
      expect(look.body.event.name).toBe('Other Show');

      const refused = await admit(gate, tickets[0].id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.details.reason).toBe('OTHER_EVENT');
      expect(refused.body.error.details.event.name).toBe('Other Show');
    });

    it('a void ticket of another (cancelled) event is VOID, not OTHER_EVENT, for both operations', async () => {
      // The Ticket Booth never offers a cancelled event as the gate (FR-007), so a cancelled
      // event's ticket always reaches another event's gate: VOID must come first (US3 scenario 2).
      const gate = await eventAroundNow(ctx, venueId, {
        startsInSeconds: 3600,
        lastsSeconds: 10800,
        name: 'This Gate',
      });
      const cancelled = await eventAroundNow(ctx, await venue(ctx, 'Other Hall'), {
        startsInSeconds: 3600,
        lastsSeconds: 10800,
        name: 'Cancelled Show',
      });
      const { tickets } = await orderWithTickets(ctx, cancelled, { quantity: 1 });
      await asAdmin(ctx).post(`/events/${cancelled}/cancel`).expect(200);

      const look = await lookup(gate, tickets[0].code);
      expect(look.status).toBe(200);
      expect(look.body.state).toBe('VOID');

      const refused = await admit(gate, tickets[0].id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.details.reason).toBe('VOID');
    });

    it('a ticket admitted before its event was cancelled is VOID and keeps its checkedInAt', async () => {
      const eventId = await eventAroundNow(ctx, venueId, {
        startsInSeconds: 3600,
        lastsSeconds: 10800,
      });
      const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
      await admit(eventId, tickets[0].id).then((r) => expect(r.status).toBe(200));
      await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

      const look = await lookup(eventId, tickets[0].code);
      expect(look.body.state).toBe('VOID');
      // VOID is told before USED; the usedAt in the answer is null (contract: unless USED).
      expect(look.body.usedAt).toBeNull();
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
      expect(row.checkedInAt).not.toBeNull();
    });

    it('a used ticket of an ended event is USED, not ENDED', async () => {
      const eventId = await eventAroundNow(ctx, venueId, {
        startsInSeconds: -3600,
        lastsSeconds: 1800,
      });
      const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
      // Admitted while it was open: write the entry directly, as the demo data does.
      await ctx.prisma.ticket.update({
        where: { id: tickets[0].id },
        data: { checkedInAt: new Date(Date.now() - 45 * 60_000) },
      });
      const look = await lookup(eventId, tickets[0].code);
      expect(look.body.state).toBe('USED');
      expect(look.body.usedAt).toEqual(expect.any(String));
    });
  });
});
