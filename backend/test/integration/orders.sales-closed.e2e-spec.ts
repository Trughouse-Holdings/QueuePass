import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { atInstant, customer, event, HOLDER, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 006 FR-014 (research R2): sales close when an event starts, under the event lock. */
describe('Sales close at the start time', () => {
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

  const order = async (eventId: string, body: object) =>
    (await customer(ctx)).post(`/events/${eventId}/orders`).send({ holderName: HOLDER, ...body });
  const code = (res: Response): string => res.body.error?.code;

  /** A three-hour window starting `offsetMs` from now (negative: already started). */
  const startingIn = (offsetMs: number) => {
    const start = Date.now() + offsetMs;
    return {
      startsAt: atInstant(start),
      endsAt: atInstant(start + 3 * 3_600_000),
    };
  };

  it('refuses an order once the event has started, and records nothing', async () => {
    const eventId = await event(ctx, venueId, startingIn(-60_000));

    const res = await order(eventId, { quantity: 1 });

    expect(res.status).toBe(409);
    expect(code(res)).toBe('SALES_CLOSED');
    expect(res.body.error.message).toBe('Sales for Season Opener closed when it started.');
    expect(await ctx.prisma.order.count()).toBe(0);
  });

  it('accepts an order for an event that starts in an hour', async () => {
    const eventId = await event(ctx, venueId, startingIn(3_600_000));
    expect((await order(eventId, { quantity: 1 })).status).toBe(201);
  });

  it('says cancelled, not sales closed, for a cancelled event that has started', async () => {
    const eventId = await event(ctx, venueId, startingIn(-60_000));
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const res = await order(eventId, { quantity: 1 });

    expect(res.status).toBe(409);
    expect(code(res)).toBe('EVENT_CANCELLED');
  });

  it('still returns an earlier order for a repeated requestId after the event starts', async () => {
    const eventId = await event(ctx, venueId, startingIn(3_600_000));
    const body = { quantity: 1, requestId: randomUUID() };
    const first = await order(eventId, body);
    expect(first.status).toBe(201);
    // Move the start into the past, as if the hour had passed.
    await ctx.prisma.event.update({
      where: { id: eventId },
      data: { startsAt: new Date(Date.now() - 60_000) },
    });

    const repeat = await order(eventId, body);

    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(first.body.id);
  });
});
