import { EntryService } from '../../src/entry/entry.service';
import { asAdmin } from '../setup/authed-request';
import { agent, eventAroundNow, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 017 US3 (FR-011, FR-019; research R5): the entry window `[startsAt - 2h, endsAt)` on the
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

  it('starting in 2 hours 30 seconds is NOT_OPEN, with entryOpensAt, for lookup and admit', async () => {
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

  it('starting in 1 hour 59 minutes 30 seconds is ADMITTABLE and admits', async () => {
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
    // earlier just before the re-read (FR-019, research R5), as the clock would at the
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
        SET "startsAt" = "startsAt" - interval '1 minute', "endsAt" = "endsAt" - interval '1 minute'
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
