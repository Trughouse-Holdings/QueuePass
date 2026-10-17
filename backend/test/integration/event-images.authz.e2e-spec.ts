import { operations } from '../contract/expect-to-match-contract';
import { anon, as, type Client } from '../setup/authed-request';
import { event, venue } from '../setup/fixtures';
import { PNG, upload } from '../setup/images';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/**
 * Spec 014 FR-002, FR-013 (Constitution V): every image operation needs a valid token; only a
 * QueuePass Admin may change images; any signed-in role may read one.
 *
 * An operation still marked `x-planned` in the contract is not served yet (research R8; delete
 * and reorder arrive with US3, T032). Its cases run once the marker is gone, so this file covers
 * all four operations without a failing case for a route the contract says does not exist yet.
 */
describe('Event image endpoints: authorization', () => {
  let ctx: TestContext;
  let eventId: string;
  let imageId: string;
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
    eventId = await event(ctx, await venue(ctx));
    imageId = (await upload(ctx, eventId, PNG).expect(201)).body.id;
  });

  const served = (operationId: string) =>
    operations.find((o) => o.operationId === operationId)?.planned === null;

  const writes = [
    {
      op: 'uploadEventImage',
      run: (c: Client) =>
        c
          .post(`/events/${eventId}/images`)
          .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }),
    },
    {
      op: 'deleteEventImage',
      run: (c: Client) => c.delete(`/events/${eventId}/images/${imageId}`),
    },
    {
      op: 'reorderEventImages',
      run: (c: Client) => c.put(`/events/${eventId}/images/order`).send({ imageIds: [imageId] }),
    },
  ];
  const read = {
    op: 'getEventImage',
    run: (c: Client) => c.get(`/events/${eventId}/images/${imageId}`),
  };
  const all = () => [...writes, read].filter((w) => served(w.op));

  const snapshot = () => ctx.prisma.eventImage.findMany({ orderBy: { id: 'asc' } });

  it('covers all four image operations of the contract', () => {
    const declared = operations
      .filter((o) => o.path.startsWith('/events/{id}/images'))
      .map((o) => o.operationId)
      .sort();
    expect([...writes, read].map((w) => w.op).sort()).toEqual(declared);
    expect(served('uploadEventImage') && served('getEventImage')).toBe(true);
  });

  it('refuses every operation without a token, or with an expired, wrongly signed, or wrong-audience token', async () => {
    const before = await snapshot();
    for (const [name, client] of [
      ['missing', anon(ctx)],
      ['expired', as(ctx, tokens.expired!)],
      ['wrongly signed', as(ctx, tokens.rogue!)],
      ['wrong audience', as(ctx, tokens.audience!)],
    ] as const) {
      for (const w of all()) {
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
    it(`refuses every image write from a ${role} with 403 and changes nothing`, async () => {
      const before = await snapshot();
      for (const w of writes.filter((x) => served(x.op))) {
        const res = await w.run(as(ctx, tokens[role]!));
        expect({ op: w.op, status: res.status, code: res.body.error?.code }).toEqual({
          op: w.op,
          status: 403,
          code: 'FORBIDDEN',
        });
      }
      expect(await snapshot()).toEqual(before);
    });

    it(`lets a ${role} read an image`, async () => {
      const res = await read.run(as(ctx, tokens[role]!)).expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.body).toEqual(PNG);
    });
  }
});
