import type { Prisma } from '@prisma/client';
import request, { type Response } from 'supertest';
import { expectToMatchContract } from '../contract/expect-to-match-contract';
import { asAdmin } from '../setup/authed-request';
import { venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 031 (FR-001 to FR-006, FR-015, SC-001; research R3, R4, R9, R11): `POST /events` takes the
 * event's ticket types and saves them in one transaction, all or nothing. Every refusal leaves the
 * counts of Event and TicketTier rows unchanged. Spec 038 (T009a): `007`'s reserved seating by
 * section-to-type mapping is retired with contract 2.0.0; its cases went, and T020
 * (`event-seating.e2e-spec.ts`) tests an event's layout, level prices and off-sale seats.
 */
describe('Scheduling an event with its ticket types (031)', () => {
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
  const create = (body: object) => asAdmin(ctx).post('/events').send(body);
  const general = (over: object = {}) =>
    create(
      base(plainVenue, {
        totalTicketCapacity: 500,
        tiers: [
          { name: 'Floor', price: '80.00', quantity: 300 },
          { name: 'Balcony', price: '60.00', quantity: 200 },
        ],
        ...over,
      }),
    );
  const code = (res: Response): string => res.body.error?.code;
  const fields = (res: Response): string[] => res.body.error?.details?.fields ?? [];
  const counts = async () => ({
    events: await ctx.prisma.event.count(),
    tiers: await ctx.prisma.ticketTier.count(),
  });

  /** Sends the request and checks nothing new is in the database afterwards. */
  const refused = async (send: () => Promise<Response>, status: number): Promise<Response> => {
    const before = await counts();
    const res = await send();
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    expect(await counts()).toEqual(before);
    return res;
  };

  /** Every entry about the new fields starts with its place (R3): no default message leaks. */
  const placed = (res: Response) => {
    for (const entry of fields(res)) {
      expect(entry).toMatch(/^(tiers|totalTicketCapacity)/);
    }
  };

  describe('saved whole', () => {
    it('saves a general-admission event with both ticket types and their quantities', async () => {
      const res = await general().expect(201);
      expectToMatchContract(res, 'createEvent');
      expect(res.body).toMatchObject({ reservedSeating: false, totalTicketCapacity: 500 });
      const tiers = await ctx.prisma.ticketTier.findMany({
        where: { eventId: res.body.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(tiers.map((t) => [t.name, t.price.toFixed(2), t.quantity])).toEqual([
        ['Floor', '80.00', 300],
        ['Balcony', '60.00', 200],
      ]);
    });

    it('answers a body without the new fields, or with tiers: [], exactly as before', async () => {
      const old = await create(base(plainVenue, { totalTicketCapacity: 100 })).expect(201);
      const empty = await create(
        base(plainVenue, { ...windowAt(402), totalTicketCapacity: 100, tiers: [] }),
      ).expect(201);
      for (const res of [old, empty]) expectToMatchContract(res, 'createEvent');
      const shape = (body: Record<string, unknown>) => {
        const {
          id: _id,
          startsAt: _s,
          endsAt: _e,
          doorsOpenAt: _d,
          entryOpensAt: _o,
          createdAt: _c,
          updatedAt: _u,
          ...rest
        } = body;
        return rest;
      };
      expect(shape(empty.body)).toEqual(shape(old.body));
      expect(Object.keys(empty.body).sort()).toEqual(Object.keys(old.body).sort());
      expect(await ctx.prisma.ticketTier.count()).toBe(0);
    });
  });

  describe('refused whole, nothing saved', () => {
    it.each([
      ['Floor', 'floor'],
      ['Floor', ' Floor '],
    ])('refuses a repeated name (%p, %p) at the second type', async (first, second) => {
      const res = await refused(
        () =>
          general({
            tiers: [
              { name: first, price: '80.00', quantity: 300 },
              { name: second, price: '60.00', quantity: 200 },
            ],
          }),
        409,
      );
      expectToMatchContract(res, 'createEvent');
      expect(code(res)).toBe('TIER_NAME_TAKEN');
      expect(res.body.error.details).toEqual({ field: 'tiers.1.name' });
      expect(res.body.error.message).toBe(
        `Ticket type 2, '${second.trim()}', has the same name as ticket type 1, '${first}'. ` +
          'Give each ticket type its own name.',
      );
    });

    it('refuses a missing quantity', async () => {
      const res = await refused(() => general({ tiers: [{ name: 'Floor', price: '80.00' }] }), 400);
      expect(code(res)).toBe('VALIDATION_FAILED');
      expect(fields(res)).toEqual(['tiers.0.quantity is required for a tier']);
    });

    it('refuses null for tiers', async () => {
      const tiers = await refused(() => general({ tiers: null }), 400);
      expect(fields(tiers)).toHaveLength(3);
      for (const entry of fields(tiers)) expect(entry).toMatch(/^tiers /);
    });

    it('refuses more than 50 ticket types', async () => {
      const many = Array.from({ length: 51 }, (_, i) => ({
        name: `T${i}`,
        price: '1.00',
        quantity: 1,
      }));
      const res = await refused(() => general({ tiers: many }), 400);
      expect(fields(res)).toContain('tiers may hold at most 50 ticket types');
      placed(res);
    });

    it('refuses an entry that is not an object', async () => {
      const res = await refused(() => general({ tiers: [5] }), 400);
      expect(fields(res)).toContain(
        'tiers.tiers must be a list of ticket types, each an object with a name and a price',
      );
      placed(res);
    });

    it('refuses quantities over the capacity, naming both numbers', async () => {
      const res = await refused(
        () =>
          general({
            totalTicketCapacity: 400,
            tiers: [
              { name: 'A', price: '80.00', quantity: 300 },
              { name: 'B', price: '60.00', quantity: 200 },
            ],
          }),
        409,
      );
      expectToMatchContract(res, 'createEvent');
      expect(code(res)).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.details).toEqual({
        field: 'tiers',
        totalTicketCapacity: 400,
        tierTotal: 500,
      });
      expect(res.body.error.message).toBe(
        'Season Opener has 400 tickets, but its ticket types add up to 500.',
      );
    });

    it('lists malformed fields of two types at once, each with its path', async () => {
      const res = await refused(
        () =>
          general({
            tiers: [
              { name: 'Floor', price: '80.001', quantity: 1 },
              { name: '', price: '60.00', quantity: 0 },
            ],
          }),
        400,
      );
      expectToMatchContract(res, 'createEvent');
      expect(fields(res)).toEqual(
        expect.arrayContaining([
          'tiers.0.price must be a non-negative decimal string with at most 2 decimal places',
          'tiers.1.name must be between 1 and 100 characters',
          'tiers.1.quantity must be a positive whole number',
        ]),
      );
      placed(res);
    });

    it('refuses an unknown field in a type', async () => {
      const res = await refused(
        () => general({ tiers: [{ name: 'Floor', price: '80.00', quantity: 1, colour: 'red' }] }),
        400,
      );
      expect(fields(res)).toEqual(['tiers.0.property colour should not exist']);
    });

    it('refuses a scheduling conflict with ticket types', async () => {
      await general().expect(201);
      const res = await refused(() => general({ name: 'Second' }), 409);
      expect(code(res)).toBe('SCHEDULING_CONFLICT');
    });

    it('reports in R4 order: the conflict before a repeated name', async () => {
      await general().expect(201);
      const res = await refused(
        () =>
          general({
            name: 'Second',
            tiers: [
              { name: 'Floor', price: '80.00', quantity: 1 },
              { name: 'floor', price: '60.00', quantity: 1 },
            ],
          }),
        409,
      );
      expect(code(res)).toBe('SCHEDULING_CONFLICT');
    });

    it('leaves nothing when a write after the event and its types fails (FR-015)', async () => {
      // A Jest spy on the transaction client: the second ticket type's insert throws after the
      // event and the first type were written (the less invasive of R11's two options; no database
      // object). Spec 038 (T009a): before 038 the mapping insert, now gone, was the last write.
      const original = ctx.prisma.$transaction.bind(ctx.prisma);
      const written: string[] = [];
      let creates = 0;
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
                    if (key === 'create' && creates++ === 1) {
                      return async () => {
                        written.push(
                          `${await target.event.count()} events, ${await target.ticketTier.count()} tiers`,
                        );
                        throw new Error('injected: second ticket type insert failed');
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
        // Sent without the helper's contract check: the contract declares no 500, and this one
        // is injected. The envelope is still the standard one (Constitution I).
        const res = await refused(
          () =>
            request(ctx.app.getHttpServer())
              .post('/events')
              .set('Authorization', `Bearer ${ctx.adminToken}`)
              .send(
                base(plainVenue, {
                  totalTicketCapacity: 500,
                  tiers: [
                    { name: 'Floor', price: '80.00', quantity: 300 },
                    { name: 'Balcony', price: '60.00', quantity: 200 },
                  ],
                }),
              ),
          500,
        );
        expect(res.body.error.code).toEqual(expect.any(String));
        expect(res.body.error.message).toEqual(expect.any(String));
        // The failure came after the first writes, inside the transaction.
        expect(written).toEqual(['1 events, 1 tiers']);
      } finally {
        spy.mockRestore();
      }
      expect(await counts()).toEqual({ events: 0, tiers: 0 });
    });
  });
});
