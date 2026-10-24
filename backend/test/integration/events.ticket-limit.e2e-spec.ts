import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { HOLDER, ADDRESS, customer, event, venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 016 US3 (FR-001, FR-008–FR-011, FR-017; research R1, R6): storing the limit. */
describe('Per-customer ticket limit on events', () => {
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

  const base = (over: object = {}) => ({
    name: 'Season Opener',
    locationId: venueId,
    ...windowAt(400),
    totalTicketCapacity: 100,
    basePrice: '45.00',
    ...over,
  });
  const create = (over: object = {}) => asAdmin(ctx).post('/events').send(base(over));
  const patch = (id: string, body: object) => asAdmin(ctx).patch(`/events/${id}`).send(body);
  const code = (res: Response): string => res.body.error?.code;
  const fields = (res: Response): string[] => res.body.error?.details?.fields ?? [];

  describe('storing it', () => {
    it('stores and returns a limit given on create', async () => {
      const res = await create({ maxTicketsPerCustomer: 4 }).expect(201);
      expect(res.body.maxTicketsPerCustomer).toBe(4);
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.maxTicketsPerCustomer).toBe(4);
    });

    it('has no limit when none is given, or null is sent', async () => {
      expect((await create().expect(201)).body.maxTicketsPerCustomer).toBeNull();
      const res = await create({ ...windowAt(401), maxTicketsPerCustomer: null }).expect(201);
      expect(res.body.maxTicketsPerCustomer).toBeNull();
    });

    it('changes it, clears it with null, and leaves it alone when the key is absent', async () => {
      const id = await event(ctx, venueId, { maxTicketsPerCustomer: 4 });

      expect((await patch(id, { maxTicketsPerCustomer: 6 }).expect(200)).body).toMatchObject({
        maxTicketsPerCustomer: 6,
      });
      expect((await patch(id, { name: 'Renamed' }).expect(200)).body).toMatchObject({
        name: 'Renamed',
        maxTicketsPerCustomer: 6,
      });
      expect((await patch(id, { maxTicketsPerCustomer: null }).expect(200)).body).toMatchObject({
        maxTicketsPerCustomer: null,
      });
    });

    it.each([0, -1, 2.5, '4'])(
      'refuses %p on create and on update, naming the field',
      async (v) => {
        const created = await create({ maxTicketsPerCustomer: v }).expect(400);
        expect(code(created)).toBe('VALIDATION_FAILED');
        expect(fields(created).join(' ')).toMatch(/maxTicketsPerCustomer/);

        const id = await event(ctx, venueId);
        const updated = await patch(id, { maxTicketsPerCustomer: v }).expect(400);
        expect(code(updated)).toBe('VALIDATION_FAILED');
        expect(fields(updated).join(' ')).toMatch(/maxTicketsPerCustomer/);
        const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
        expect(row.maxTicketsPerCustomer).toBeNull();
      },
    );

    it('sends null for an event without a limit in the list and in the event (FR-017)', async () => {
      const id = await event(ctx, venueId);
      const list = await asAdmin(ctx).get('/events').expect(200);
      expect(list.body[0]).toHaveProperty('maxTicketsPerCustomer', null);
      const one = await asAdmin(ctx).get(`/events/${id}`).expect(200);
      expect(one.body).toHaveProperty('maxTicketsPerCustomer', null);
    });

    it('is backed by the database: an out-of-range value written directly is refused', async () => {
      const id = await event(ctx, venueId, { capacity: 10 });
      for (const bad of [0, 11]) {
        await expect(
          ctx.prisma.event.update({ where: { id }, data: { maxTicketsPerCustomer: bad } }),
        ).rejects.toThrow(/event_max_tickets_per_customer_range/);
      }
      await expect(
        ctx.prisma.event.update({ where: { id }, data: { maxTicketsPerCustomer: 10 } }),
      ).resolves.toMatchObject({ maxTicketsPerCustomer: 10 });
      // A capacity cut below the stored limit is refused by the same CHECK.
      await expect(
        ctx.prisma.event.update({ where: { id }, data: { totalTicketCapacity: 9 } }),
      ).rejects.toThrow(/event_max_tickets_per_customer_range/);
    });
  });

  describe("its range: 1 to the event's ticket capacity (research R6)", () => {
    const tooBig = (res: Response, capacity: number) => {
      expect(code(res)).toBe('VALIDATION_FAILED');
      expect(fields(res).join(' ')).toMatch(/maxTicketsPerCustomer/);
      expect(fields(res).join(' ')).toContain(String(capacity));
    };

    it('refuses a limit above the capacity on create, and accepts one equal to it', async () => {
      tooBig(await create({ maxTicketsPerCustomer: 101 }).expect(400), 100);
      expect(await ctx.prisma.event.count()).toBe(0);
      const res = await create({ maxTicketsPerCustomer: 100 }).expect(201);
      expect(res.body.maxTicketsPerCustomer).toBe(100);
    });

    it('refuses a limit above the capacity on update, and accepts one equal to it', async () => {
      const id = await event(ctx, venueId, { capacity: 100, maxTicketsPerCustomer: 4 });
      tooBig(await patch(id, { maxTicketsPerCustomer: 101 }).expect(400), 100);
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row.maxTicketsPerCustomer).toBe(4);
      await patch(id, { maxTicketsPerCustomer: 100 }).expect(200);
    });

    it("checks against the venue's capacity when the event's is left out", async () => {
      const small = await asAdmin(ctx)
        .post('/locations')
        .send({ name: 'Small Room', ...ADDRESS, seatingCapacity: 50 })
        .expect(201);
      const noCapacity = { locationId: small.body.id, totalTicketCapacity: undefined };
      tooBig(await create({ ...noCapacity, maxTicketsPerCustomer: 51 }).expect(400), 50);
      const res = await create({ ...noCapacity, maxTicketsPerCustomer: 50 }).expect(201);
      expect(res.body).toMatchObject({ totalTicketCapacity: 50, maxTicketsPerCustomer: 50 });
    });

    it('refuses a capacity cut below the stored limit with 409, changing nothing', async () => {
      const id = await event(ctx, venueId, { capacity: 100, maxTicketsPerCustomer: 8 });

      const res = await patch(id, { totalTicketCapacity: 6 }).expect(409);

      expect(code(res)).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.details).toEqual({
        proposedTicketCapacity: 6,
        maxTicketsPerCustomer: 8,
      });
      expect(res.body.error.message).toBe(
        'Cannot set ticket capacity to 6; this event allows 8 tickets per customer. ' +
          'Lower its limit first.',
      );
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ totalTicketCapacity: 100, maxTicketsPerCustomer: 8 });
    });

    it('answers 400 when the same cut sends a limit still too big, and saves a fitting one', async () => {
      const id = await event(ctx, venueId, { capacity: 100, maxTicketsPerCustomer: 8 });
      tooBig(await patch(id, { totalTicketCapacity: 6, maxTicketsPerCustomer: 7 }).expect(400), 6);

      const res = await patch(id, { totalTicketCapacity: 6, maxTicketsPerCustomer: 6 }).expect(200);
      expect(res.body).toMatchObject({ totalTicketCapacity: 6, maxTicketsPerCustomer: 6 });
    });

    it('keeps the existing refusal when the cut also falls below the tickets sold', async () => {
      const id = await event(ctx, venueId, { capacity: 100, maxTicketsPerCustomer: 8 });
      for (const n of [1, 2]) {
        await (
          await customer(ctx, n)
        )
          .post(`/events/${id}/orders`)
          .send({ holderName: HOLDER, quantity: 5 })
          .expect(201);
      }

      const res = await patch(id, { totalTicketCapacity: 7 }).expect(409);
      expect(code(res)).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.details).toEqual({ proposedTicketCapacity: 7, ticketsSold: 10 });
    });
  });

  describe('lowering, clearing, and cancelled events', () => {
    it('lowers the limit below what a customer holds, leaving their order alone (FR-009)', async () => {
      const id = await event(ctx, venueId, { maxTicketsPerCustomer: 8 });
      const placed = await (
        await customer(ctx)
      )
        .post(`/events/${id}/orders`)
        .send({ holderName: HOLDER, quantity: 6 })
        .expect(201);

      await patch(id, { maxTicketsPerCustomer: 4 }).expect(200);

      const after = await ctx.prisma.order.findUniqueOrThrow({
        where: { id: placed.body.id },
        include: { tickets: true },
      });
      expect(after.status).toBe('CONFIRMED');
      expect(after.tickets.filter((t) => t.status === 'VALID')).toHaveLength(6);
    });

    it('cannot change the limit of a cancelled event (FR-010)', async () => {
      const id = await event(ctx, venueId, { maxTicketsPerCustomer: 8 });
      await asAdmin(ctx).post(`/events/${id}/cancel`).expect(200);

      for (const value of [4, null]) {
        const res = await patch(id, { maxTicketsPerCustomer: value }).expect(409);
        expect(code(res)).toBe('EVENT_CANCELLED');
      }
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row.maxTicketsPerCustomer).toBe(8);
    });
  });

  describe("a venue layout below a seated event's limit (research R6)", () => {
    const A = (rows: number) => ({ name: 'A', rows, seatsPerRow: 10 });
    const layout = (rows: number) =>
      asAdmin(ctx)
        .put(`/locations/${venueId}/layout`)
        .send({ sections: [A(rows)] });

    /** An unsold, scheduled event with reserved seating at a 30-seat layout. */
    const seatedEvent = async (limit: number) => {
      await layout(3).expect(200);
      const id = await event(ctx, venueId, {
        name: 'Seated Show',
        capacity: 30,
        maxTicketsPerCustomer: limit,
      });
      await asAdmin(ctx)
        .put(`/events/${id}/seating`)
        .send({ reservedSeating: true, sections: [] })
        .expect(200);
      return id;
    };

    it('refuses a layout with fewer seats than the limit, naming the event, changing nothing', async () => {
      const id = await seatedEvent(25);

      const res = await layout(2).expect(409);

      expect(code(res)).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.message).toContain('"Seated Show"');
      expect(res.body.error.message).toMatch(/Lower its limit first/);
      expect(res.body.error.details).toEqual({
        totalSeats: 20,
        conflictingEvent: { id, name: 'Seated Show' },
      });
      const saved = await asAdmin(ctx).get(`/locations/${venueId}/layout`).expect(200);
      expect(saved.body.totalSeats).toBe(30);
      const venueRow = await ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } });
      expect(venueRow.seatingCapacity).toBe(30);
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ totalTicketCapacity: 30, maxTicketsPerCustomer: 25 });
    });

    it('accepts a layout whose total equals the limit', async () => {
      const id = await seatedEvent(20);
      await layout(2).expect(200);
      const row = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ totalTicketCapacity: 20, maxTicketsPerCustomer: 20 });
    });
  });
});
