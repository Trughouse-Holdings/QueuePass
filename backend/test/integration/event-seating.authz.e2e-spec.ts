import { operations } from '../contract/expect-to-match-contract';
import { anon, as, asAdmin, type Client } from '../setup/authed-request';
import { layoutRefs, venue, windowAt, type InsertedLayout } from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/**
 * Spec 038 US2 (Constitution V): an event's seating is an admin's. `getEventSeating` and the
 * seating fields of `createEvent` and `updateEvent` need a valid token (`401`) and the
 * `queuepass-admin` role (`403`); each refusal changes nothing.
 */
describe('Event seating: authorization (038)', () => {
  let ctx: TestContext;
  let venueId: string;
  let layout: InsertedLayout;
  let eventId: string;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    tokens.customer = await tokenFor(CUSTOMER);
    tokens.agent = await tokenFor(AGENT);
    tokens.expired = await tokenFor({
      username: 'admin1',
      roles: ['queuepass-admin'],
      expiresIn: -60,
    });
    tokens.rogue = await tokenFor({ username: 'admin1', roles: ['queuepass-admin'], rogue: true });
    tokens.audience = await tokenFor({
      username: 'admin1',
      roles: ['queuepass-admin'],
      aud: 'some-other-api',
    });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx);
    const res = await asAdmin(ctx)
      .post(`/locations/${venueId}/layouts`)
      .send({
        name: 'Club',
        levels: [{ name: 'Front', color: 'violet' }],
        sections: [{ name: 'A', rows: 2, seatsPerRow: 5, level: 'Front' }],
      })
      .expect(201);
    layout = await layoutRefs(ctx, res.body.id);
    eventId = (
      await asAdmin(ctx)
        .post('/events')
        .send({
          name: 'Seated Show',
          locationId: venueId,
          ...windowAt(420),
          basePrice: '1.00',
          layoutId: layout.id,
          levelPrices: [{ levelId: layout.levels.Front, price: '20.00' }],
        })
        .expect(201)
    ).body.id;
  });

  const cases = [
    { op: 'getEventSeating', run: (c: Client) => c.get(`/events/${eventId}/seating`) },
    {
      op: 'createEvent',
      run: (c: Client) =>
        c.post('/events').send({
          name: 'Another',
          locationId: venueId,
          ...windowAt(430),
          basePrice: '1.00',
          layoutId: layout.id,
          levelPrices: [{ levelId: layout.levels.Front, price: '20.00' }],
          offSale: [{ sectionId: layout.sections.A, row: 1 }],
        }),
    },
    {
      op: 'updateEvent',
      run: (c: Client) =>
        c.patch(`/events/${eventId}`).send({
          levelPrices: [{ levelId: layout.levels.Front, price: '1.00' }],
          offSale: [{ sectionId: layout.sections.A, row: 2 }],
        }),
    },
    {
      op: 'updateEvent',
      run: (c: Client) => c.patch(`/events/${eventId}`).send({ layoutId: null }),
    },
  ];

  const snapshot = async () => ({
    events: await ctx.prisma.event.findMany({ orderBy: { id: 'asc' } }),
    prices: await ctx.prisma.eventLevelPrice.findMany({ orderBy: { levelId: 'asc' } }),
    offSale: await ctx.prisma.eventOffSaleSeat.count(),
  });

  it('is an admin operation in the contract, served', () => {
    for (const op of ['getEventSeating', 'createEvent', 'updateEvent']) {
      const declared = operations.find((o) => o.operationId === op);
      expect({ op, roles: declared?.requiredRoles, planned: declared?.planned }).toEqual({
        op,
        roles: ['queuepass-admin'],
        planned: null,
      });
    }
  });

  it('refuses each without a token, or with an expired, wrongly signed, or wrong-audience token', async () => {
    const before = await snapshot();
    for (const [name, client] of [
      ['missing', anon(ctx)],
      ['expired', as(ctx, tokens.expired!)],
      ['wrongly signed', as(ctx, tokens.rogue!)],
      ['wrong audience', as(ctx, tokens.audience!)],
    ] as const) {
      for (const c of cases) {
        const res = await c.run(client);
        expect({ token: name, op: c.op, status: res.status, code: res.body.error?.code }).toEqual({
          token: name,
          op: c.op,
          status: 401,
          code: 'UNAUTHENTICATED',
        });
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  for (const role of ['customer', 'agent'] as const) {
    it(`refuses each from a ${role} with 403 and changes nothing`, async () => {
      const before = await snapshot();
      for (const c of cases) {
        const res = await c.run(as(ctx, tokens[role]!));
        expect({ op: c.op, status: res.status, code: res.body.error?.code }).toEqual({
          op: c.op,
          status: 403,
          code: 'FORBIDDEN',
        });
      }
      expect(await snapshot()).toEqual(before);
    });
  }

  it('lets an admin read and save the seating', async () => {
    for (const c of cases) {
      const res = await c.run(asAdmin(ctx));
      expect({ op: c.op, ok: res.status < 300 }).toEqual({ op: c.op, ok: true });
    }
  });
});
