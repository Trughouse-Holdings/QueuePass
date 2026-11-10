import type { Prisma } from '@prisma/client';
import type { Response } from 'supertest';
import { expectToMatchContract } from '../contract/expect-to-match-contract';
import { asAdmin } from '../setup/authed-request';
import { venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 031 (FR-001 to FR-006, FR-015, SC-001; research R3, R4, R9, R11): `POST /events` takes the
 * event's ticket types and reserved seating and saves them in one transaction, all or nothing.
 * Every refusal leaves the counts of Event, TicketTier, and SectionTier rows unchanged.
 */
describe('Scheduling an event with its ticket types and seating (031)', () => {
  let ctx: TestContext;
  let plainVenue: string;
  let seatedVenue: string;
  let otherVenue: string;
  /** Seated Hall's sections: front 1×10, middle 2×10, back 3×10 (60 seats). */
  let front: string;
  let middle: string;
  let back: string;
  let foreign: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    plainVenue = await venue(ctx, 'Plain Hall');
    seatedVenue = await venue(ctx, 'Seated Hall');
    otherVenue = await venue(ctx, 'Other Hall');
    const layout = await asAdmin(ctx)
      .put(`/locations/${seatedVenue}/layout`)
      .send({
        sections: [
          { name: 'front', rows: 1, seatsPerRow: 10 },
          { name: 'middle', rows: 2, seatsPerRow: 10 },
          { name: 'back', rows: 3, seatsPerRow: 10 },
        ],
      })
      .expect(200);
    [front, middle, back] = layout.body.sections.map((s: { id: string }) => s.id);
    const other = await asAdmin(ctx)
      .put(`/locations/${otherVenue}/layout`)
      .send({ sections: [{ name: 'X', rows: 1, seatsPerRow: 5 }] })
      .expect(200);
    foreign = other.body.sections[0].id;
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
  const seated = (over: object = {}) =>
    create(
      base(seatedVenue, {
        reservedSeating: true,
        tiers: [
          { name: 'Front', price: '120.00', sectionIds: [front] },
          { name: 'Standard', price: '70.00', sectionIds: [middle] },
        ],
        ...over,
      }),
    );

  const code = (res: Response): string => res.body.error?.code;
  const fields = (res: Response): string[] => res.body.error?.details?.fields ?? [];
  const counts = async () => ({
    events: await ctx.prisma.event.count(),
    tiers: await ctx.prisma.ticketTier.count(),
    mappings: await ctx.prisma.sectionTier.count(),
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
      expect(entry).toMatch(/^(tiers|reservedSeating|totalTicketCapacity)/);
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
      expect(await ctx.prisma.sectionTier.count()).toBe(0);
    });

    it('saves a seated event: capacity the layout, quantities its sections, the mappings', async () => {
      const res = await seated({
        tiers: [
          { name: 'Front', price: '120.00', sectionIds: [front] },
          { name: 'Standard', price: '70.00', sectionIds: [middle] },
          { name: 'Later', price: '50.00' },
        ],
      }).expect(201);
      expectToMatchContract(res, 'createEvent');
      expect(res.body).toMatchObject({ reservedSeating: true, totalTicketCapacity: 60 });
      const tiers = await ctx.prisma.ticketTier.findMany({ where: { eventId: res.body.id } });
      const quantity = (name: string) => tiers.find((t) => t.name === name)?.quantity;
      expect([quantity('Front'), quantity('Standard'), quantity('Later')]).toEqual([10, 20, 0]);
      const mappings = await ctx.prisma.sectionTier.findMany({ where: { eventId: res.body.id } });
      expect(mappings).toHaveLength(2);

      const map = await asAdmin(ctx).get(`/events/${res.body.id}/seats`).expect(200);
      const tierOf = (sectionId: string) =>
        map.body.sections.find((s: { sectionId: string }) => s.sectionId === sectionId).tierId;
      expect(map.body.reservedSeating).toBe(true);
      expect(tierOf(front)).toBe(tiers.find((t) => t.name === 'Front')?.id);
      expect(tierOf(middle)).toBe(tiers.find((t) => t.name === 'Standard')?.id);
      expect(tierOf(back)).toBeNull();
    });

    it('allows reserved seating with no ticket types (as turning it on is today)', async () => {
      const res = await seated({ tiers: undefined }).expect(201);
      expect(res.body).toMatchObject({ reservedSeating: true, totalTicketCapacity: 60 });
    });

    it('answers a body without the new fields, or with tiers: [], exactly as before', async () => {
      const old = await create(base(plainVenue, { totalTicketCapacity: 100 })).expect(201);
      const empty = await create(
        base(plainVenue, { ...windowAt(402), totalTicketCapacity: 100, tiers: [] }),
      ).expect(201);
      const off = await create(
        base(plainVenue, { ...windowAt(404), totalTicketCapacity: 100, reservedSeating: false }),
      ).expect(201);
      for (const res of [old, empty, off]) expectToMatchContract(res, 'createEvent');
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
      expect(shape(off.body)).toEqual(shape(old.body));
      expect(Object.keys(empty.body).sort()).toEqual(Object.keys(old.body).sort());
      expect(await ctx.prisma.ticketTier.count()).toBe(0);
    });

    it('accepts sectionIds: [] without reserved seating', async () => {
      await general({
        tiers: [{ name: 'Floor', price: '80.00', quantity: 300, sectionIds: [] }],
      }).expect(201);
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

    it('refuses a missing quantity without reserved seating', async () => {
      const res = await refused(() => general({ tiers: [{ name: 'Floor', price: '80.00' }] }), 400);
      expect(code(res)).toBe('VALIDATION_FAILED');
      expect(fields(res)).toEqual(['tiers.0.quantity is required for a tier']);
    });

    it('refuses a quantity with reserved seating', async () => {
      const res = await refused(
        () => seated({ tiers: [{ name: 'Front', price: '120.00', quantity: 10 }] }),
        400,
      );
      expect(fields(res)).toEqual([
        "tiers.0.quantity must be omitted: it follows this tier's sections while reserved seating is on",
      ]);
    });

    it('refuses a non-empty sectionIds without reserved seating', async () => {
      const res = await refused(
        () =>
          create(
            base(seatedVenue, {
              tiers: [{ name: 'Front', price: '120.00', quantity: 10, sectionIds: [front] }],
            }),
          ),
        400,
      );
      expect(fields(res)).toHaveLength(1);
      expect(fields(res)[0]).toMatch(/^tiers\.0\.sectionIds /);
    });

    it('refuses null for reservedSeating, tiers, and a type’s sectionIds', async () => {
      const seating = await refused(() => general({ reservedSeating: null }), 400);
      expect(fields(seating)).toEqual(['reservedSeating must be true or false']);

      const tiers = await refused(() => general({ tiers: null }), 400);
      expect(fields(tiers)).toHaveLength(3);
      for (const entry of fields(tiers)) expect(entry).toMatch(/^tiers /);

      const sections = await refused(
        () => seated({ tiers: [{ name: 'Front', price: '120.00', sectionIds: null }] }),
        400,
      );
      expect(fields(sections)).toHaveLength(4);
      for (const entry of fields(sections)) expect(entry).toMatch(/^tiers\.0\.sectionIds /);
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

    it.each([
      ['a section of another venue', () => foreign],
      ['a random id', () => '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'],
    ])('refuses %s, saying to reload', async (_label, section) => {
      const res = await refused(
        () => seated({ tiers: [{ name: 'Front', price: '120.00', sectionIds: [section()] }] }),
        400,
      );
      expect(fields(res)).toEqual([
        "tiers.0.sectionIds lists a section that is not in Seated Hall's seating layout. " +
          'Reload the form to see its sections.',
      ]);
    });

    it('refuses a section under two ticket types, at the second', async () => {
      const res = await refused(
        () =>
          seated({
            tiers: [
              { name: 'Front', price: '120.00', sectionIds: [front] },
              { name: 'Standard', price: '70.00', sectionIds: [middle, front] },
            ],
          }),
        400,
      );
      expect(fields(res)).toHaveLength(1);
      expect(fields(res)[0]).toMatch(/^tiers\.1\.sectionIds .*front.*Front/);
    });

    it('refuses a repeated id in one sectionIds', async () => {
      const res = await refused(
        () => seated({ tiers: [{ name: 'Front', price: '120.00', sectionIds: [front, front] }] }),
        400,
      );
      expect(fields(res)).toEqual(['tiers.0.sectionIds lists a section more than once']);
    });

    it('refuses reserved seating at a venue without a layout', async () => {
      const res = await refused(
        () =>
          create(
            base(plainVenue, {
              reservedSeating: true,
              tiers: [{ name: 'Floor', price: '80.00' }],
            }),
          ),
        400,
      );
      expect(fields(res)).toEqual(['reservedSeating needs a seating layout; Plain Hall has none']);
    });

    it('refuses totalTicketCapacity with reserved seating', async () => {
      const res = await refused(() => seated({ totalTicketCapacity: 60 }), 400);
      expect(fields(res)).toEqual([
        "totalTicketCapacity is set by the venue's seating layout while reserved seating is on",
      ]);
    });

    it('refuses a limit above the layout total, as today', async () => {
      const res = await refused(() => seated({ maxTicketsPerCustomer: 61 }), 400);
      expect(fields(res)[0]).toMatch(/^maxTicketsPerCustomer .*\(60\)/);
      await seated({ maxTicketsPerCustomer: 60 }).expect(201);
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

    it('reports in R4 order: a repeated name before a bad section in a later type', async () => {
      const res = await refused(
        () =>
          seated({
            tiers: [
              { name: 'Front', price: '120.00', sectionIds: [front] },
              { name: 'front', price: '70.00', sectionIds: [middle] },
              { name: 'Back', price: '50.00', sectionIds: [foreign] },
            ],
          }),
        409,
      );
      expect(code(res)).toBe('TIER_NAME_TAKEN');
      expect(res.body.error.details.field).toBe('tiers.1.name');
    });

    it('leaves nothing when a write after the event and its types fails (FR-015)', async () => {
      // A Jest spy on the transaction client: the mapping insert throws after the event and its
      // ticket types were written (the less invasive of R11's two options; no database object).
      const original = ctx.prisma.$transaction.bind(ctx.prisma);
      const written: string[] = [];
      const spy = jest.spyOn(ctx.prisma, '$transaction').mockImplementation(((
        fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: object,
      ) =>
        original(async (tx: Prisma.TransactionClient) => {
          const failing = new Proxy(tx, {
            get(target, prop, receiver) {
              const value = Reflect.get(target, prop, receiver);
              if (prop === 'sectionTier') {
                return new Proxy(value as object, {
                  get(model, key, r) {
                    if (key === 'createMany') {
                      return async () => {
                        written.push(
                          `${await target.event.count()} events, ${await target.ticketTier.count()} tiers`,
                        );
                        throw new Error('injected: mapping insert failed');
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
        const res = await refused(() => seated(), 500);
        expect(res.body.error.code).toEqual(expect.any(String));
        expect(res.body.error.message).toEqual(expect.any(String));
        // The failure came after the first writes, inside the transaction.
        expect(written).toEqual(['1 events, 2 tiers']);
      } finally {
        spy.mockRestore();
      }
      expect(await counts()).toEqual({ events: 0, tiers: 0, mappings: 0 });
    });
  });
});
