import type { Response } from 'supertest';
import { windowAt as liveWindowAt } from '@queuepass/shared';
import { agent, eventAroundNow, liveCodeFor, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 018 US4 (FR-015, SC-004; research R6): one entry per ticket whichever code led to the
 * admit. Ten agents look the ticket up by its live code and ten by its printed code, then all
 * twenty admit at once; 017's row-locked UPDATE, unchanged, lets exactly one through.
 */
describe('One entry per ticket, live and printed lookups racing', () => {
  let ctx: TestContext;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    eventId = await eventAroundNow(ctx, await venue(ctx), {
      startsInSeconds: 3600,
      lastsSeconds: 10800,
    });
  });
  afterEach(() => ctx.clock.useRealTime());

  /** A 5xx anywhere would show up as a confusing miscount. */
  const no5xx = (results: Response[]): void => {
    const failed = results.filter((r) => r.status >= 500);
    expect(failed.map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
  };

  it('of 20 simultaneous admits after mixed lookups, exactly one succeeds — 5 rounds (SC-004)', async () => {
    const w = liveWindowAt(Date.now());
    ctx.clock.set(w * 30_000 + 15_000);
    const agents = await Promise.all(Array.from({ length: 20 }, (_, i) => agent(ctx, i + 1)));

    for (let round = 1; round <= 5; round++) {
      const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
      const live = await liveCodeFor(ctx, tickets[0].id, w);
      const lookups = await Promise.all(
        agents.map((a, i) =>
          a.post(`/events/${eventId}/entry/lookup`).send({ code: i < 10 ? live : tickets[0].code }),
        ),
      );
      no5xx(lookups);
      for (const [i, r] of lookups.entries()) {
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({
          state: 'ADMITTABLE',
          verifiedBy: i < 10 ? 'LIVE_CODE' : 'TICKET_CODE',
        });
      }

      const results = await Promise.all(
        agents.map((a, i) =>
          a
            .post(`/events/${eventId}/entry/admit`)
            .send({ ticketId: lookups[i].body.ticketId, wholeOrder: false }),
        ),
      );
      no5xx(results);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const refused = results.filter((r) => r.status === 409);
      expect(refused).toHaveLength(19);
      for (const r of refused) {
        expect(r.body.error.code).toBe('ENTRY_REFUSED');
        expect(r.body.error.details.reason).toBe('USED');
      }
    }
  });
});
