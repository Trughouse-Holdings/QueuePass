import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { agent, eventAroundNow, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor } from '../setup/tokens';

/**
 * Spec 017 US2 (FR-015, FR-015a, SC-001; research R4, Constitution IV): one entry per ticket
 * under genuinely simultaneous admits, guaranteed by PostgreSQL's row lock in one conditional
 * UPDATE — no application lock anywhere.
 */
describe('One entry per ticket under concurrent admits', () => {
  let ctx: TestContext;
  let venueId: string;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx);
    eventId = await eventAroundNow(ctx, venueId, { startsInSeconds: 3600, lastsSeconds: 10800 });
  });

  /** A 5xx anywhere would show up as a confusing miscount. */
  const no5xx = (results: Response[]): void => {
    const failed = results.filter((r) => r.status >= 500);
    expect(failed.map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
  };

  it('of 20 simultaneous admits from 20 agents, exactly one succeeds — 5 rounds (SC-001)', async () => {
    for (let round = 1; round <= 5; round++) {
      const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
      const agents = await Promise.all(
        Array.from({ length: 20 }, (_, i) => agent(ctx, i + 1)),
      );
      const results = await Promise.all(
        agents.map((a) =>
          a
            .post(`/events/${eventId}/entry/admit`)
            .send({ ticketId: tickets[0].id, wholeOrder: false }),
        ),
      );
      no5xx(results);
      const won = results.filter((r) => r.status === 200);
      const refused = results.filter((r) => r.status === 409);
      expect(won).toHaveLength(1);
      expect(refused).toHaveLength(19);
      for (const r of refused) {
        expect(r.body.error.code).toBe('ENTRY_REFUSED');
        expect(r.body.error.details.reason).toBe('USED');
      }
      // The row records the winner, by subject identifier (Constitution V).
      const winner = won[0];
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
      expect(row.checkedInAt).not.toBeNull();
      const winnerIndex = results.indexOf(winner);
      expect(row.checkedInBySub).toBe(subFor(`agent${winnerIndex + 1}`));
    }
  });

  it('wholeOrder racing single admits of its 4 tickets: exactly one entry each, none twice', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 4 });
    const [wholeAgent, ...singles] = await Promise.all([1, 2, 3, 4, 5].map((n) => agent(ctx, n)));
    const results = await Promise.all([
      wholeAgent
        .post(`/events/${eventId}/entry/admit`)
        .send({ ticketId: tickets[0].id, wholeOrder: true }),
      ...tickets.map((t, i) =>
        singles[i]
          .post(`/events/${eventId}/entry/admit`)
          .send({ ticketId: t.id, wholeOrder: false }),
      ),
    ]);
    no5xx(results);

    // Every ticket has exactly one entry.
    for (const t of tickets) {
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.checkedInAt).not.toBeNull();
      expect(row.checkedInBySub).not.toBeNull();
    }
    // Across all responses, each ticket is reported admitted exactly once.
    const admitted = results
      .filter((r) => r.status === 200)
      .flatMap((r) => r.body.admitted as { ticketId: string }[])
      .map((t) => t.ticketId);
    expect(admitted).toHaveLength(4);
    expect(new Set(admitted).size).toBe(4);
  });

  it('two Admit all presses for one order at once: 4 admitted in total, none twice', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 4 });
    const [first, second] = await Promise.all([1, 2].map((n) => agent(ctx, n)));
    const results = await Promise.all(
      [first, second].map((a) =>
        a
          .post(`/events/${eventId}/entry/admit`)
          .send({ ticketId: tickets[0].id, wholeOrder: true }),
      ),
    );
    no5xx(results);

    // Across both responses, each ticket is reported admitted exactly once.
    const admitted = results
      .filter((r) => r.status === 200)
      .flatMap((r) => r.body.admitted as { ticketId: string }[])
      .map((t) => t.ticketId);
    expect(admitted).toHaveLength(4);
    expect(new Set(admitted)).toEqual(new Set(tickets.map((t) => t.id)));
    // A press that admitted nothing was refused as USED (the other press took them all).
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
      expect(r.body.error.details.reason).toBe('USED');
    }
    // One entry per row, recorded by the agent whose response reported it.
    for (const t of tickets) {
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.checkedInAt).not.toBeNull();
      const reporter = results.findIndex(
        (r) =>
          r.status === 200 &&
          (r.body.admitted as { ticketId: string }[]).some((a) => a.ticketId === t.id),
      );
      expect(row.checkedInBySub).toBe(subFor(`agent${reporter + 1}`));
    }
  });

  it("an admit racing the admin's cancelEvent: VOID either way, and an entry is never cleared", async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const gate = await agent(ctx);
    const [admitRes, cancelRes] = await Promise.all([
      gate
        .post(`/events/${eventId}/entry/admit`)
        .send({ ticketId: tickets[0].id, wholeOrder: false }),
      asAdmin(ctx).post(`/events/${eventId}/cancel`).send(),
    ]);
    no5xx([admitRes, cancelRes]);
    expect(cancelRes.status).toBe(200);

    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(row.status).toBe('VOID');
    if (admitRes.status === 200) {
      // The admit won the race: cancelling voids the ticket but keeps the entry (FR-018).
      expect(row.checkedInAt).not.toBeNull();
    } else {
      // The cancel won: the admit was refused and recorded nothing.
      expect(admitRes.status).toBe(409);
      expect(admitRes.body.error.details.reason).toBe('VOID');
      expect(row.checkedInAt).toBeNull();
    }
  });
});
