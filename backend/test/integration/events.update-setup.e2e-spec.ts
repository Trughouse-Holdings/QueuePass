import type { Prisma } from '@prisma/client';
import request, { type Response } from 'supertest';
import { expectToMatchContract } from '../contract/expect-to-match-contract';
import { asAdmin } from '../setup/authed-request';
import { orderWithTickets, venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 035 (FR-017, FR-018, SC-004; research R8, R11): `PATCH /events/{id}` takes the event's
 * ticket types and saves them with its details in one transaction, all or nothing. Every refusal
 * leaves the event and its types unchanged. Spec 038 (T009a): `007`'s reserved seating by
 * section-to-type mapping is retired with contract 2.0.0; its cases went, and T020
 * (`event-seating.e2e-spec.ts`) tests changing an event's layout, prices and off-sale seats.
 */
describe('Updating an event with its ticket types (035)', () => {
  let ctx: TestContext;
  let plainVenue: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    plainVenue = await venue(ctx, 'Plain Hall');
  });

  const base = (locationId: string, over: object = {}) => ({
    name: 'Season Opener',
    locationId,
    ...windowAt(400),
    basePrice: '60.00',
    ...over,
  });

  const createGeneral = async (over: object = {}) => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send(
        base(plainVenue, {
          totalTicketCapacity: 500,
          tiers: [
            { name: 'Floor', price: '80.00', quantity: 300 },
            { name: 'Balcony', price: '60.00', quantity: 200 },
          ],
          ...over,
        }),
      )
      .expect(201);
    const tiers = await ctx.prisma.ticketTier.findMany({
      where: { eventId: res.body.id },
      orderBy: { createdAt: 'asc' },
    });
    return { event: res.body, floor: tiers[0]!, balcony: tiers[1]! };
  };

  const patch = (id: string, body: object) => asAdmin(ctx).patch(`/events/${id}`).send(body);

  const snapshot = async (eventId: string) => {
    const event = await ctx.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const tiers = await ctx.prisma.ticketTier.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      name: event.name,
      reservedSeating: event.reservedSeating,
      totalTicketCapacity: event.totalTicketCapacity,
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        price: t.price.toFixed(2),
        quantity: t.quantity,
      })),
    };
  };

  const refused = async (
    eventId: string,
    send: () => Promise<Response>,
    status: number,
  ): Promise<Response> => {
    const before = await snapshot(eventId);
    const res = await send();
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    expect(await snapshot(eventId)).toEqual(before);
    return res;
  };

  const sell = async (eventId: string, tierId: string, quantity: number) => {
    const { orderId } = await orderWithTickets(ctx, eventId, { quantity });
    await ctx.prisma.order.update({ where: { id: orderId }, data: { tierId } });
    await ctx.prisma.ticket.updateMany({ where: { orderId }, data: { tierId } });
  };

  describe('saved whole', () => {
    it('updates details, types, additions, and a removal in one request', async () => {
      const { event, floor, balcony } = await createGeneral();
      const res = await patch(event.id, {
        name: 'Season Opener (revised)',
        tiers: [
          { id: floor.id, name: 'Floor', price: '90.00', quantity: 280 },
          { name: 'Gallery', price: '40.00', quantity: 50 },
        ],
      }).expect(200);
      expectToMatchContract(res, 'updateEvent');
      expect(res.body).toMatchObject({ name: 'Season Opener (revised)', reservedSeating: false });
      const after = await snapshot(event.id);
      expect(after.name).toBe('Season Opener (revised)');
      expect(after.tiers.map((t) => [t.id === floor.id, t.name, t.price, t.quantity])).toEqual([
        [true, 'Floor', '90.00', 280],
        [false, 'Gallery', '40.00', 50],
      ]);
      expect(after.tiers.some((t) => t.id === balcony.id)).toBe(false);
    });

    it('leaves types alone when they are not sent', async () => {
      const { event, floor, balcony } = await createGeneral();
      const before = await snapshot(event.id);
      const res = await patch(event.id, { name: 'Only the name' }).expect(200);
      expectToMatchContract(res, 'updateEvent');
      const after = await snapshot(event.id);
      expect(after.name).toBe('Only the name');
      expect(after.tiers.map((t) => t.id)).toEqual([floor.id, balcony.id]);
      expect(after.reservedSeating).toBe(before.reservedSeating);
    });
  });

  describe('refusals leave the event unchanged', () => {
    it('refuses a repeated name together with a changed event name', async () => {
      const { event, floor, balcony } = await createGeneral();
      const res = await refused(
        event.id,
        () =>
          patch(event.id, {
            name: 'New name',
            tiers: [
              { id: floor.id, name: 'Floor', price: '80.00', quantity: 300 },
              { id: balcony.id, name: 'floor', price: '60.00', quantity: 200 },
            ],
          }),
        409,
      );
      expect(res.body.error.code).toBe('TIER_NAME_TAKEN');
      expect(res.body.error.details.field).toBe('tiers.1.name');
    });

    it('refuses an unknown, foreign, or repeated id', async () => {
      const { event, floor, balcony } = await createGeneral();
      const unknown = await refused(
        event.id,
        () =>
          patch(event.id, {
            tiers: [
              {
                id: '00000000-0000-4000-8000-000000000000',
                name: 'X',
                price: '10.00',
                quantity: 1,
              },
            ],
          }),
        400,
      );
      expect(unknown.body.error.details.fields[0]).toMatch(/^tiers\.0\.id/);

      const { event: other } = await createGeneral({
        name: 'Other Show',
        ...windowAt(410),
      });
      const { floor: foreignTier } = await (async () => {
        const tiers = await ctx.prisma.ticketTier.findMany({
          where: { eventId: other.id },
          orderBy: { createdAt: 'asc' },
        });
        return { floor: tiers[0]! };
      })();
      const foreignId = await refused(
        event.id,
        () =>
          patch(event.id, {
            tiers: [{ id: foreignTier.id, name: 'Floor', price: '80.00', quantity: 300 }],
          }),
        400,
      );
      expect(foreignId.body.error.details.fields[0]).toMatch(/^tiers\.0\.id/);

      const repeated = await refused(
        event.id,
        () =>
          patch(event.id, {
            tiers: [
              { id: floor.id, name: 'Floor', price: '80.00', quantity: 300 },
              { id: floor.id, name: 'Also floor', price: '60.00', quantity: 200 },
              { id: balcony.id, name: 'Balcony', price: '50.00', quantity: 1 },
            ],
          }),
        400,
      );
      expect(repeated.body.error.details.fields[0]).toMatch(/^tiers\.1\.id/);
    });

    it('refuses id on createEvent and creates no event', async () => {
      const before = await ctx.prisma.event.count();
      const res = await asAdmin(ctx)
        .post('/events')
        .send(
          base(plainVenue, {
            tiers: [
              {
                id: '00000000-0000-4000-8000-000000000000',
                name: 'Floor',
                price: '80.00',
                quantity: 300,
              },
            ],
          }),
        );
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields[0]).toMatch(/^tiers\.0\.id/);
      expect(await ctx.prisma.event.count()).toBe(before);
    });

    it('refuses to remove a type that has orders', async () => {
      const { event, floor, balcony } = await createGeneral();
      await sell(event.id, floor.id, 1);
      const res = await refused(
        event.id,
        () =>
          patch(event.id, {
            tiers: [{ id: balcony.id, name: 'Balcony', price: '60.00', quantity: 200 }],
          }),
        409,
      );
      expect(res.body.error.code).toBe('TIER_HAS_ORDERS');
      expect(res.body.error.details.field).toBe('tiers');
    });

    it('refuses a quantity below tickets sold', async () => {
      const { event, floor, balcony } = await createGeneral();
      await sell(event.id, floor.id, 10);
      const res = await refused(
        event.id,
        () =>
          patch(event.id, {
            tiers: [
              { id: floor.id, name: 'Floor', price: '80.00', quantity: 5 },
              { id: balcony.id, name: 'Balcony', price: '60.00', quantity: 200 },
            ],
          }),
        409,
      );
      expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.details.field).toBe('tiers.0.quantity');
    });

    it('leaves the event unchanged when a write after the first change fails', async () => {
      const { event, floor, balcony } = await createGeneral();
      const original = ctx.prisma.$transaction.bind(ctx.prisma);
      const spy = jest.spyOn(ctx.prisma, '$transaction').mockImplementation(((
        fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: object,
      ) =>
        original(async (tx: Prisma.TransactionClient) => {
          const failing = new Proxy(tx, {
            get(target, prop, receiver) {
              const value = Reflect.get(target, prop, receiver);
              if (prop === 'ticketTier') {
                return new Proxy(value as object, {
                  get(model, key, r) {
                    if (key === 'create') {
                      return async () => {
                        throw new Error('injected: new type insert failed');
                      };
                    }
                    return Reflect.get(model, key, r);
                  },
                });
              }
              return value;
            },
          });
          return fn(failing);
        }, options as never)) as never);
      try {
        const before = await snapshot(event.id);
        const res = await request(ctx.app.getHttpServer())
          .patch(`/events/${event.id}`)
          .set('Authorization', `Bearer ${ctx.adminToken}`)
          .send({
            name: 'Should roll back',
            totalTicketCapacity: 510,
            tiers: [
              { id: floor.id, name: 'Floor', price: '80.00', quantity: 300 },
              { id: balcony.id, name: 'Balcony', price: '60.00', quantity: 200 },
              { name: 'Gallery', price: '40.00', quantity: 10 },
            ],
          });
        expect(res.status).toBe(500);
        expect(res.body.error.code).toEqual(expect.any(String));
        expect(await snapshot(event.id)).toEqual(before);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
