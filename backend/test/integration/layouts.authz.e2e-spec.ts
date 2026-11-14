import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { operations } from '../contract/expect-to-match-contract';
import { anon, as, asAdmin, type Client } from '../setup/authed-request';
import { venue } from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/**
 * Spec 038 FR-008 (Constitution V): every layout operation needs a valid token; only a QueuePass
 * Admin may make, change, duplicate or delete a layout; any signed-in role may read one (the map is
 * public). Each refusal changes nothing.
 */
describe('Venue layout endpoints: authorization (038)', () => {
  let ctx: TestContext;
  let venueId: string;
  let layoutId: string;
  let sectionId: string;
  const tokens: Record<string, string> = {};
  const file = JSON.parse(
    readFileSync(join(__dirname, '../fixtures/layouts/small.json'), 'utf8'),
  ) as Record<string, unknown>;
  const lines = {
    name: 'Club room',
    levels: [{ name: 'Front', color: 'violet' }],
    sections: [{ name: 'A', rows: 2, seatsPerRow: 5, level: 'Front' }],
  };

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
    const res = await asAdmin(ctx).post(`/locations/${venueId}/layouts/import`).send({ file });
    expect(res.status).toBe(201);
    layoutId = res.body.id;
    sectionId = res.body.sections[0].id;
  });

  const writes = [
    {
      op: 'createVenueLayout',
      run: (c: Client) => c.post(`/locations/${venueId}/layouts`).send(lines),
    },
    {
      op: 'importVenueLayout',
      run: (c: Client) =>
        c.post(`/locations/${venueId}/layouts/import`).send({ name: 'Another', file }),
    },
    {
      op: 'updateVenueLayout',
      run: (c: Client) => c.put(`/layouts/${layoutId}`).send({ name: 'Renamed' }),
    },
    {
      op: 'duplicateVenueLayout',
      run: (c: Client) => c.post(`/layouts/${layoutId}/duplicate`),
    },
    { op: 'deleteVenueLayout', run: (c: Client) => c.delete(`/layouts/${layoutId}`) },
  ];
  const reads = [
    { op: 'listVenueLayouts', run: (c: Client) => c.get(`/locations/${venueId}/layouts`) },
    { op: 'getVenueLayout', run: (c: Client) => c.get(`/layouts/${layoutId}`) },
    {
      op: 'getVenueLayoutSection',
      run: (c: Client) => c.get(`/layouts/${layoutId}/sections/${sectionId}`),
    },
  ];
  const all = [...writes, ...reads];

  const snapshot = async () => ({
    layouts: await ctx.prisma.layout.findMany({ orderBy: { id: 'asc' } }),
    seats: await ctx.prisma.seat.count(),
    venue: await ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } }),
  });

  it('covers the eight layout operations of the contract, all served', () => {
    const declared = operations
      .filter((o) => o.path.startsWith('/layouts') || o.path.startsWith('/locations/{id}/layouts'))
      .map((o) => o.operationId)
      .sort();
    expect(all.map((w) => w.op).sort()).toEqual(declared);
    expect(operations.filter((o) => declared.includes(o.operationId) && o.planned)).toEqual([]);
    for (const w of writes) {
      expect(operations.find((o) => o.operationId === w.op)?.requiredRoles).toEqual([
        'queuepass-admin',
      ]);
    }
    for (const r of reads) {
      expect(operations.find((o) => o.operationId === r.op)?.requiredRoles).toEqual([]);
    }
  });

  it('refuses every operation without a token, or with an expired, wrongly signed, or wrong-audience token', async () => {
    const before = await snapshot();
    for (const [name, client] of [
      ['missing', anon(ctx)],
      ['expired', as(ctx, tokens.expired!)],
      ['wrongly signed', as(ctx, tokens.rogue!)],
      ['wrong audience', as(ctx, tokens.audience!)],
    ] as const) {
      for (const w of all) {
        const res = await w.run(client);
        expect({ token: name, op: w.op, status: res.status, code: res.body.error?.code }).toEqual({
          token: name,
          op: w.op,
          status: 401,
          code: 'UNAUTHENTICATED',
        });
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  for (const role of ['customer', 'agent'] as const) {
    it(`refuses every layout write from a ${role} with 403 and changes nothing`, async () => {
      const before = await snapshot();
      for (const w of writes) {
        const res = await w.run(as(ctx, tokens[role]!));
        expect({ op: w.op, status: res.status, code: res.body.error?.code }).toEqual({
          op: w.op,
          status: 403,
          code: 'FORBIDDEN',
        });
      }
      expect(await snapshot()).toEqual(before);
    });

    it(`lets a ${role} read the layouts, a layout and a section`, async () => {
      for (const r of reads) {
        const res = await r.run(as(ctx, tokens[role]!));
        expect({ op: r.op, status: res.status }).toEqual({ op: r.op, status: 200 });
      }
    });
  }
});
