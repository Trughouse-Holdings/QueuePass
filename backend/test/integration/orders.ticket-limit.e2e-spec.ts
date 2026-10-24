import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, reserveThenOrder, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor, tokenFor } from '../setup/tokens';

/**
 * Spec 016 US1 (FR-002, FR-003, FR-005–FR-007; research R2–R4): a customer never goes over an
 * event's per-customer limit, counted across all their orders.
 */
describe('Per-customer ticket limit on orders', () => {
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

  const order = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, ...body });
  const buy = async (eventId: string, quantity: number, n = 1) => {
    const res = await order(eventId, { quantity }, n);
    expect(res.status).toBe(201);
    return res;
  };
  const code = (res: Response): string => res.body.error?.code;
  /** Valid tickets `customer<n>` holds for an event, straight from the database. */
  const held = (eventId: string, n = 1) =>
    ctx.prisma.ticket.count({
      where: { eventId, status: 'VALID', order: { customerSub: subFor(`customer${n}`) } },
    });
  const limited = (limit: number, capacity = 100) =>
    event(ctx, venueId, { capacity, maxTicketsPerCustomer: limit });

  it('confirms an order of exactly the limit from a customer holding none', async () => {
    const eventId = await limited(8);
    await buy(eventId, 8);
    expect(await held(eventId)).toBe(8);
  });

  it('refuses an order over the limit with the numbers, and records nothing', async () => {
    const eventId = await limited(8);
    await buy(eventId, 5);
    const orders = await ctx.prisma.order.count();
    const tickets = await ctx.prisma.ticket.count();

    const res = await order(eventId, { quantity: 5 });

    expect(res.status).toBe(409);
    expect(code(res)).toBe('TICKET_LIMIT_REACHED');
    expect(res.body.error.details).toEqual({ limit: 8, held: 5, remaining: 3, requested: 5 });
    expect(res.body.error.message).toBe(
      'Season Opener allows 8 tickets per customer. You already hold 5, so you can get 3 more; ' +
        '5 were requested.',
    );
    expect(await ctx.prisma.order.count()).toBe(orders);
    expect(await ctx.prisma.ticket.count()).toBe(tickets);
  });

  it('then takes the 3 left, and refuses one more with nothing remaining', async () => {
    const eventId = await limited(8);
    await buy(eventId, 5);
    await buy(eventId, 3);

    const res = await order(eventId, { quantity: 1 });

    expect(res.status).toBe(409);
    expect(code(res)).toBe('TICKET_LIMIT_REACHED');
    expect(res.body.error.details).toEqual({ limit: 8, held: 8, remaining: 0, requested: 1 });
    expect(res.body.error.message).toBe(
      'Season Opener allows 8 tickets per customer, and you already hold 8.',
    );
    expect(await held(eventId)).toBe(8);
  });

  it('accepts reaching the limit exactly and refuses one over (both sides of the boundary)', async () => {
    const eventId = await limited(4);
    await buy(eventId, 2);
    const over = await order(eventId, { quantity: 3 });
    expect(over.status).toBe(409);
    expect(over.body.error.details).toMatchObject({ held: 2, remaining: 2, requested: 3 });
    await buy(eventId, 2);
    expect(await held(eventId)).toBe(4);
  });

  it("does not count one customer's tickets against another", async () => {
    const eventId = await limited(8);
    await buy(eventId, 8, 1);
    await buy(eventId, 8, 2);
    expect(await held(eventId, 2)).toBe(8);
  });

  it('judges each event only against its own limit', async () => {
    const first = await limited(8);
    const second = await limited(2);
    await buy(first, 8);
    await buy(second, 2);
    expect(code(await order(second, { quantity: 1 }))).toBe('TICKET_LIMIT_REACHED');
  });

  it('counts tickets of every tier together', async () => {
    const eventId = await limited(8);
    const general = await tier(ctx, eventId, 'General', '40.00', 50);
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 50);
    await order(eventId, { tierId: general, quantity: 5 }).then((r) => expect(r.status).toBe(201));
    await order(eventId, { tierId: vip, quantity: 3 }).then((r) => expect(r.status).toBe(201));

    const res = await order(eventId, { tierId: general, quantity: 1 });
    expect(code(res)).toBe('TICKET_LIMIT_REACHED');
    expect(res.body.error.details).toMatchObject({ held: 8, remaining: 0 });
  });

  it('does not count void tickets', async () => {
    const eventId = await limited(8);
    const placed = await buy(eventId, 8);
    await ctx.prisma.ticket.update({
      where: { id: placed.body.tickets[0].id },
      data: { status: 'VOID' },
    });

    await buy(eventId, 1);
    expect(await held(eventId)).toBe(8);
  });

  it('accepts repeated orders as before for an event with no limit', async () => {
    const eventId = await event(ctx, venueId, { capacity: 100 });
    for (let i = 0; i < 3; i++) await buy(eventId, 10);
    expect(await held(eventId)).toBe(30);
  });

  describe('when tickets left and the limit both bind (research R3)', () => {
    it('says SOLD_OUT when fewer tickets are left than the customer may still get', async () => {
      const eventId = await limited(8, 20);
      await buy(eventId, 5, 1);
      await buy(eventId, 8, 2);
      await buy(eventId, 6, 3); // 1 left; customer1 may get 3 more

      const res = await order(eventId, { quantity: 2 }, 1);
      expect(res.status).toBe(409);
      expect(code(res)).toBe('SOLD_OUT');
      expect(res.body.error.details).toEqual({ available: 1, requested: 2 });
    });

    it('says TICKET_LIMIT_REACHED when the limit leaves fewer than the tickets left', async () => {
      const eventId = await limited(8, 57);
      await buy(eventId, 7, 1); // 50 left; customer1 may get 1 more

      const res = await order(eventId, { quantity: 2 }, 1);
      expect(code(res)).toBe('TICKET_LIMIT_REACHED');
      expect(res.body.error.details).toEqual({ limit: 8, held: 7, remaining: 1, requested: 2 });
    });

    it('says SOLD_OUT on a tie', async () => {
      const eventId = await limited(8, 20);
      await buy(eventId, 6, 1);
      await buy(eventId, 8, 2);
      await buy(eventId, 4, 3); // 2 left; customer1 may get 2 more

      const res = await order(eventId, { quantity: 3 }, 1);
      expect(code(res)).toBe('SOLD_OUT');
      expect(res.body.error.details).toEqual({ available: 2, requested: 3 });
    });
  });

  it('returns a repeated requestId with 200 and counts it once, even at the limit (FR-007)', async () => {
    const eventId = await limited(8);
    const body = { quantity: 8, requestId: randomUUID() };
    const first = await order(eventId, body);
    expect(first.status).toBe(201);

    const again = await order(eventId, body);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await held(eventId)).toBe(8);
  });

  it('counts the seats of a reserved-seating event toward the limit', async () => {
    const layout = await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({ sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }] })
      .expect(200);
    const sectionA = layout.body.sections[0].id;
    const eventId = await limited(3, 30);
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
    const seat = (s: number) => ({ sectionId: sectionA, row: 1, seat: s });

    const token = await tokenFor({ username: 'customer1', roles: ['customer'] });
    await reserveThenOrder(ctx, token, eventId, { seats: [seat(1), seat(2)] }).then((r) =>
      expect(r.status).toBe(201),
    );
    // Spec 015 FR-003: seats are reserved before they are ordered, so the limit now refuses them
    // at Reserve seats, with the same numbers.
    const res = await (
      await customer(ctx)
    )
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(3), seat(4)] });

    expect(code(res)).toBe('TICKET_LIMIT_REACHED');
    expect(res.body.error.details).toEqual({ limit: 3, held: 2, remaining: 1, requested: 2 });
  });

  it('still applies the per-order cap of 10 under a higher limit (FR-006)', async () => {
    const eventId = await limited(20);
    const res = await order(eventId, { quantity: 11 });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('VALIDATION_FAILED');
  });

  it('never reports a negative remainder after the limit is lowered below what is held', async () => {
    const eventId = await limited(8);
    await buy(eventId, 6);
    await ctx.prisma.event.update({ where: { id: eventId }, data: { maxTicketsPerCustomer: 4 } });

    const res = await order(eventId, { quantity: 1 });
    expect(code(res)).toBe('TICKET_LIMIT_REACHED');
    expect(res.body.error.details).toEqual({ limit: 4, held: 6, remaining: 0, requested: 1 });
    expect(res.body.error.message).toBe(
      'Season Opener allows 4 tickets per customer, and you already hold 6.',
    );
  });
});
