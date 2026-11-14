import { randomUUID } from 'node:crypto';
import { as } from '../setup/authed-request';
import { HOLDER, event, seatedEvent, venue } from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 026 US3 (FR-004, FR-016, SC-004; research R9, R10): an ordinary customer, at a person's
 * pace on the attempt clock, with the default limits, is never refused for them. Releases come back
 * to back, as a person pressing Release on several seats one after another (spec Clarifications):
 * counted as holds, they would be refused here.
 */
describe('An ordinary customer and the attempt limits', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ attemptLimits: 'defaults' });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  it('holds, adds, releases, holds, buys, buys again, and checks again with no 429', async () => {
    const venueId = await venue(ctx, 'Ordinary Hall');
    // Spec 038: a seated event on a layout made from section lines, one level at 45.00.
    const { eventId: seated, layout } = await seatedEvent(ctx, venueId, {
      sections: [{ name: 'A', rows: 1, seatsPerRow: 10 }],
    });
    const sectionId = layout.sections.A;
    const general = await event(ctx, await venue(ctx, 'Open Hall'), { capacity: 100 });
    const c = as(ctx, await tokenFor({ username: 'rl-ordinary', roles: ['customer'] }));
    const seat = (n: number) => ({ sectionId, row: 1, seat: n });
    const statuses: number[] = [];
    const step = async (send: () => Promise<{ status: number }>, pause = 2_000) => {
      statuses.push((await send()).status);
      ctx.attemptClock.advance(pause);
    };
    const hold = (...seats: number[]) =>
      c.post(`/events/${seated}/reservation`).send({ seats: seats.map(seat) });
    const release = (n: number) =>
      c.post(`/events/${seated}/reservation/release`).send({ seats: [seat(n)] });

    await step(() => hold(1, 2));
    await step(() => hold(3));
    await step(() => release(1), 0);
    await step(() => release(2));
    await step(() => hold(4));
    await step(() =>
      c
        .post(`/events/${seated}/orders`)
        .send({ holderName: HOLDER, quantity: 2, seats: [seat(3), seat(4)] }),
    );
    const requestId = randomUUID();
    const gaOrder = () =>
      c.post(`/events/${general}/orders`).send({ holderName: HOLDER, quantity: 2, requestId });
    await step(gaOrder);
    await step(gaOrder);

    expect(statuses).toEqual([201, 200, 200, 200, 200, 201, 201, 200]);
  });
});

/**
 * Spec 026 FR-017 (independent review M5), spec 033 FR-008: the whole app refuses to start on a
 * wrong setting, the hold pair's as the buy pair's.
 */
describe('The Backend with a wrong attempt-limit setting', () => {
  const BUY = { perMinute: 10, perFiveSeconds: 3 };
  it.each([
    [
      { perMinute: 0, perFiveSeconds: 3 },
      "RATE_LIMIT_PER_MINUTE must be a whole number of at least 1, got '0'",
    ],
    [
      { perMinute: 2, perFiveSeconds: 3 },
      "RATE_LIMIT_PER_5_SECONDS ('3') must not be more than RATE_LIMIT_PER_MINUTE ('2')",
    ],
    [
      { BUY, HOLD: { perMinute: 0, perFiveSeconds: 10 } },
      "RATE_LIMIT_HOLD_PER_MINUTE must be a whole number of at least 1, got '0'",
    ],
    [
      { BUY, HOLD: { perMinute: 30, perFiveSeconds: 0 } },
      "RATE_LIMIT_HOLD_PER_5_SECONDS must be a whole number of at least 1, got '0'",
    ],
    [
      { BUY, HOLD: { perMinute: 9, perFiveSeconds: 10 } },
      "RATE_LIMIT_HOLD_PER_5_SECONDS ('10') must not be more than RATE_LIMIT_HOLD_PER_MINUTE ('9')",
    ],
  ])('does not start with %j', async (attemptLimits, message) => {
    await expect(createTestApp({ attemptLimits })).rejects.toThrow(message);
  });
});
