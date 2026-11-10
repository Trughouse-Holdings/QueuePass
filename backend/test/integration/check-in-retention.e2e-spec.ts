import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CHECK_IN_RETENTION_DAYS } from '@queuepass/shared';
import { CheckInRetention } from '../../src/entry/check-in-retention';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { asAdmin } from '../setup/authed-request';
import { atInstant, customer, event, HOLDER, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MINUTE = 60_000;
const WEEK = CHECK_IN_RETENTION_DAYS * DAY;

/** E's fixed window: 7:00 PM to 10:00 PM Eastern on Oct 1, 2026 (EDT). */
const E_START = Date.parse('2026-10-01T23:00:00Z');
const E_END = Date.parse('2026-10-02T02:00:00Z');

/**
 * Spec 032 US1, US2 (FR-001 to FR-006, FR-009, SC-001 to SC-004, SC-007; research R4, R5, R11):
 * the retention job against real PostgreSQL, with the Backend's clock fixed to the minute.
 */
describe('Check-in retention', () => {
  let ctx: TestContext;
  let retention: CheckInRetention;

  beforeAll(async () => {
    ctx = await createTestApp();
    retention = ctx.app.get(CheckInRetention);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });
  afterEach(() => {
    ctx.clock.useRealTime();
    jest.restoreAllMocks();
  });

  /** Moves an event to a fixed window by SQL (the API refuses nothing here, but sales close). */
  const placeAt = async (id: string, start: number, end: number): Promise<void> => {
    await ctx.prisma.$executeRaw`
      UPDATE "Event" SET "startsAt" = ${new Date(start)}::timestamptz,
                         "endsAt" = ${new Date(end)}::timestamptz,
                         "doorsOpenAt" = ${new Date(start - HOUR)}::timestamptz
      WHERE "id" = ${id}::uuid`;
  };

  /** An event with an order of `n` tickets bought through the API, a year ahead. */
  const eventWithTickets = async (
    venueId: string,
    name: string,
    n: number,
  ): Promise<{ id: string; tickets: string[] }> => {
    const id = await event(ctx, venueId, { name });
    if (n > 0) {
      await (await customer(ctx, 1))
        .post(`/events/${id}/orders`)
        .send({ holderName: HOLDER, quantity: n })
        .expect(201);
    }
    const tickets = await ctx.prisma.ticket.findMany({
      where: { eventId: id },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    return { id, tickets: tickets.map((t) => t.id) };
  };

  /** Admitted with all three details, as `tryAdmit` writes them. */
  const admit = (ticketId: string, at: number) =>
    ctx.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        checkedInAt: new Date(at),
        checkedInBySub: 'demo-agent1',
        checkedInByUsername: 'agent1',
      },
    });

  const ticketRows = (eventId: string) =>
    ctx.prisma.ticket.findMany({
      where: { eventId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        checkedInAt: true,
        checkedInBySub: true,
        checkedInByUsername: true,
        orderId: true,
        code: true,
      },
    });
  const eventRow = (id: string) => ctx.prisma.event.findUniqueOrThrow({ where: { id } });
  const snapshot = async (ids: string[]) =>
    Promise.all(ids.map(async (id) => ({ event: await eventRow(id), tickets: await ticketRows(id) })));

  /**
   * E (ended at E_END; 4 tickets: one admitted with all three details, one with its time only,
   * one never admitted, one void with an admission time), F (another venue, ending a day after
   * E, one ticket admitted), G (not ended, one ticket admitted).
   */
  const fixtures = async () => {
    const hall = await venue(ctx, 'Retention Hall');
    const other = await venue(ctx, 'Other Hall');
    const e = await eventWithTickets(hall, 'Fall Concert', 4);
    const f = await eventWithTickets(other, 'Comedy Night', 1);
    const g = await eventWithTickets(other, 'Winter Gala', 1);
    await placeAt(e.id, E_START, E_END);
    await placeAt(f.id, E_START + DAY, E_END + DAY);
    const [e1, e2, , e4] = e.tickets;
    await admit(e1, E_START - 10 * MINUTE);
    await ctx.prisma.ticket.update({
      where: { id: e2 },
      data: { checkedInAt: new Date(E_START - 5 * MINUTE) },
    });
    await admit(e4, E_START - 20 * MINUTE);
    await ctx.prisma.ticket.update({ where: { id: e4 }, data: { status: 'VOID' } });
    await admit(f.tickets[0], E_START + DAY - 10 * MINUTE);
    await admit(g.tickets[0], Date.now() - MINUTE);
    return { hall, other, e: e.id, f: f.id, g: g.id };
  };

  describe('the cutoff (US1; FR-001, FR-002, FR-003, FR-004, SC-001)', () => {
    it('keeps everything at endsAt + 7 days − 1 minute', async () => {
      const { e, f, g } = await fixtures();
      const before = await snapshot([e, f, g]);
      ctx.clock.set(E_END + WEEK - MINUTE);

      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [] });
      expect(await snapshot([e, f, g])).toEqual(before);
    });

    it('removes all three details from every ticket of the event at endsAt + 7 days, and keeps its count', async () => {
      const { e, f, g } = await fixtures();
      const others = await snapshot([f, g]);
      const now = E_END + WEEK;
      ctx.clock.set(now);

      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [e] });

      const tickets = await ticketRows(e);
      expect(tickets).toHaveLength(4);
      for (const t of tickets) {
        expect(t).toMatchObject({
          checkedInAt: null,
          checkedInBySub: null,
          checkedInByUsername: null,
        });
      }
      // Nothing else on a ticket changes (FR-002): the void one stays void.
      expect(tickets.filter((t) => t.status === 'VOID')).toHaveLength(1);
      const removed = await eventRow(e);
      expect(removed.checkInDetailsRemovedAt).toEqual(new Date(now));
      // The valid tickets that had an admission time: the full entry and the time-only one.
      expect(removed.keptCheckedInCount).toBe(2);
      expect(await snapshot([f, g])).toEqual(others);
    });

    it('changes nothing on a second run (FR-005, SC-003)', async () => {
      const { e, f, g } = await fixtures();
      ctx.clock.set(E_END + WEEK);
      await retention.removeDue();
      const after = await snapshot([e, f, g]);

      ctx.clock.set(E_END + 8 * DAY);
      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [] });
      expect(await snapshot([e, f, g])).toEqual(after);
    });

    it('removes a cancelled event past its cutoff, with a count of 0', async () => {
      const { e } = await fixtures();
      await asAdmin(ctx).post(`/events/${e}/cancel`).expect(200);
      ctx.clock.set(E_END + WEEK);

      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [e] });
      const row = await eventRow(e);
      expect(row.keptCheckedInCount).toBe(0);
      expect(row.checkInDetailsRemovedAt).toEqual(new Date(E_END + WEEK));
      expect((await ticketRows(e)).every((t) => t.checkedInAt === null)).toBe(true);
    });

    it('marks an event with no tickets, with a count of 0', async () => {
      const hall = await venue(ctx, 'Empty Hall');
      const empty = await event(ctx, hall, { name: 'Season Opener' });
      await placeAt(empty, E_START, E_END);
      ctx.clock.set(E_END + WEEK);

      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [empty] });
      expect(await eventRow(empty)).toMatchObject({
        checkInDetailsRemovedAt: new Date(E_END + WEEK),
        keptCheckedInCount: 0,
      });
    });

    it('follows an end moved later before the cutoff (US4-3; FR-008)', async () => {
      const { e } = await fixtures();
      const zone = (await eventRow(e).then((r) =>
        ctx.prisma.location.findUniqueOrThrow({ where: { id: r.locationId } }),
      )).timeZone as Parameters<typeof atInstant>[1];
      await asAdmin(ctx)
        .patch(`/events/${e}`)
        .send({ endsAt: atInstant(E_END + 2 * DAY, zone) })
        .expect(200);

      ctx.clock.set(E_END + WEEK);
      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [] });
      expect((await eventRow(e)).checkInDetailsRemovedAt).toBeNull();

      ctx.clock.set(E_END + 2 * DAY + WEEK - MINUTE);
      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [] });
      ctx.clock.set(E_END + 2 * DAY + WEEK);
      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [e] });
    });
  });

  describe('two removals at once (Edge Cases; FR-005; review round 1, S4)', () => {
    it('removes an event once when removeEvent runs twice at once', async () => {
      const { e } = await fixtures();
      const first = new Date(E_END + WEEK);
      const second = new Date(E_END + WEEK + MINUTE);

      const results = await Promise.all([
        retention.removeEvent(e, first),
        retention.removeEvent(e, second),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const row = await eventRow(e);
      expect(row.checkInDetailsRemovedAt).toEqual(results[0] ? first : second);
      expect(row.keptCheckedInCount).toBe(2);
    });

    it('removes an event once when two instances run at once', async () => {
      const { e } = await fixtures();
      ctx.clock.set(E_END + WEEK);
      const another = new CheckInRetention(ctx.prisma, ctx.clock, 0);

      const [a, b] = await Promise.all([retention.removeDue(), another.removeDue()]);

      expect([...a.eventIds, ...b.eventIds]).toEqual([e]);
      expect(await eventRow(e)).toMatchObject({
        checkInDetailsRemovedAt: new Date(E_END + WEEK),
        keptCheckedInCount: 2,
      });
    });
  });

  it('counts the bound in exact hours across a daylight-saving change (review rounds 1 S3, 2 S1)', async () => {
    const hall = await venue(ctx, 'DST Hall');
    const id = await event(ctx, hall, { name: 'Halloween' });
    const end = Date.parse('2026-10-31T23:00:00Z');
    await placeAt(id, end - 3 * HOUR, end);
    // Its own client with one connection, so the session's zone applies to every query it runs.
    const url = new URL(process.env.DATABASE_URL as string);
    url.searchParams.set('connection_limit', '1');
    const client = new PrismaClient({ datasourceUrl: url.toString() });
    try {
      await client.$executeRawUnsafe(`SET TIME ZONE 'America/New_York'`);
      const own = new CheckInRetention(client as unknown as PrismaService, ctx.clock, 0);

      ctx.clock.set(end + 7 * 86_400_000 - MINUTE);
      await expect(own.removeDue()).resolves.toEqual({ eventIds: [] });
      ctx.clock.set(end + 7 * 86_400_000);
      await expect(own.removeDue()).resolves.toEqual({ eventIds: [id] });
    } finally {
      await client.$disconnect();
    }
  });

  describe('the report reads the same (US2; FR-009, SC-004)', () => {
    const report = async () => (await asAdmin(ctx).get('/reports/sales').expect(200)).body;
    const withoutRemoval = (r: { events: Record<string, unknown>[] }, eventId: string) => ({
      ...r,
      generatedAt: undefined,
      events: r.events.map((row) =>
        row.eventId === eventId ? { ...row, checkInDetailsRemovedAt: undefined } : row,
      ),
    });

    it('gives every figure the same before and after the removal', async () => {
      const { e } = await fixtures();
      const before = await report();
      const row = before.events.find((r: { eventId: string }) => r.eventId === e);
      expect(row).toMatchObject({ checkedIn: 2, checkInDetailsRemovedAt: null });

      ctx.clock.set(E_END + WEEK);
      await retention.removeDue();
      const after = await report();

      expect(withoutRemoval(after, e)).toEqual(withoutRemoval(before, e));
      expect(after.events.find((r: { eventId: string }) => r.eventId === e)).toMatchObject({
        checkedIn: 2,
        checkInDetailsRemovedAt: new Date(E_END + WEEK).toISOString(),
      });
    });

    it('gives 0 for a removed event once it is cancelled, and the total drops by its count', async () => {
      const { e } = await fixtures();
      ctx.clock.set(E_END + WEEK);
      await retention.removeDue();
      const before = await report();

      await asAdmin(ctx).post(`/events/${e}/cancel`).expect(200);
      const after = await report();

      expect(after.events.find((r: { eventId: string }) => r.eventId === e).checkedIn).toBe(0);
      expect(after.totals.checkedIn).toBe(before.totals.checkedIn - 2);
    });
  });

  describe('failures (Edge Cases: a failing run; FR-006)', () => {
    it('logs one event failing and goes on with the others', async () => {
      const { e, f } = await fixtures();
      ctx.clock.set(E_END + DAY + WEEK);
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const real = retention.removeEvent.bind(retention);
      jest
        .spyOn(retention, 'removeEvent')
        .mockImplementation((id, now) =>
          id === e ? Promise.reject(new Error('lock timeout')) : real(id, now),
        );

      await expect(retention.removeDue()).resolves.toEqual({ eventIds: [f] });

      expect((await eventRow(e)).checkInDetailsRemovedAt).toBeNull();
      expect((await eventRow(f)).keptCheckedInCount).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining(e), expect.anything());
    });

    it('skips an event deleted meanwhile', async () => {
      await expect(
        retention.removeEvent('00000000-0000-4000-8000-000000000000', new Date()),
      ).resolves.toBe(false);
    });

    it('returns nothing while a run is already going', async () => {
      const { e } = await fixtures();
      ctx.clock.set(E_END + WEEK);
      const [a, b] = await Promise.all([retention.removeDue(), retention.removeDue()]);
      expect([a.eventIds, b.eventIds]).toEqual([[e], []]);
    });
  });

  describe('start() (FR-006, SC-002, SC-007; research R5)', () => {
    it('removes a due event at once, without anyone calling removeDue, and close clears its timer', async () => {
      const own = await createTestApp();
      let open = true;
      try {
        const { e } = await fixtures();
        own.clock.set(E_END + WEEK);
        const job = own.app.get(CheckInRetention);
        const removeDue = jest.spyOn(job, 'removeDue');
        const armed = jest.spyOn(global, 'setInterval');
        const cleared = jest.spyOn(global, 'clearInterval');

        job.start();

        const deadline = Date.now() + 2_000;
        while ((await eventRow(e)).checkInDetailsRemovedAt === null && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        expect((await eventRow(e)).checkInDetailsRemovedAt).toEqual(new Date(E_END + WEEK));
        expect(removeDue).toHaveBeenCalledTimes(1);
        const call = armed.mock.calls.findIndex(([, ms]) => ms === 3_600_000);
        expect(call).toBeGreaterThanOrEqual(0);
        const timer = armed.mock.results[call].value;

        open = false;
        await own.app.close();
        expect(cleared).toHaveBeenCalledWith(timer);
      } finally {
        if (open) await own.app.close();
      }
    });

    it('logs a failed run at start and never throws', async () => {
      const own = await createTestApp();
      try {
        const job = own.app.get(CheckInRetention);
        const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        jest.spyOn(job, 'removeDue').mockRejectedValue(new Error('database unreachable'));

        expect(() => job.start()).not.toThrow();
        await new Promise((r) => setTimeout(r, 50));
        expect(error).toHaveBeenCalledWith('Check-in retention failed', expect.anything());
      } finally {
        await own.app.close();
      }
    });

    it('is run by no lifecycle hook, so the demo commands never run it (SC-007; review rounds 1 M1, 2 S2)', async () => {
      const { e } = await fixtures();
      // Long past its cutoff by the real clock, which the second app keeps.
      await placeAt(e, Date.parse('2025-01-01T23:00:00Z'), Date.parse('2025-01-02T02:00:00Z'));
      const before = await snapshot([e]);

      const second = await createTestApp();
      try {
        await new Promise((r) => setTimeout(r, 500));
        const after = await snapshot([e]);
        expect(after).toEqual(before);
        expect(after[0].event).toMatchObject({
          checkInDetailsRemovedAt: null,
          keptCheckedInCount: null,
        });
        expect(after[0].tickets.filter((t) => t.checkedInAt !== null)).toHaveLength(3);
      } finally {
        await second.app.close();
      }
    });
  });
});
