import { anon, as, asAdmin } from '../setup/authed-request';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/**
 * Spec 001 FR-018, FR-021; spec 002 FR-019 to FR-021 — venues and events are readable by any
 * signed-in user and changeable, including deletable, only by a QueuePass Admin.
 */
describe('Venue and event endpoints: authorization', () => {
  let ctx: TestContext;
  let venueId: string;
  let eventId: string;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    tokens.customer = await tokenFor(CUSTOMER);
    tokens.agent = await tokenFor(AGENT);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const venue = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Yum Center', address: '1 Arena Plaza', seatingCapacity: 22090 })
      .expect(201);
    venueId = venue.body.id;
    const event = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Opener',
        locationId: venueId,
        startsAt: '2026-10-01T18:00:00Z',
        endsAt: '2026-10-01T21:00:00Z',
        totalTicketCapacity: 100,
        basePrice: '10.00',
      })
      .expect(201);
    eventId = event.body.id;
  });

  const writes = () => [
    {
      name: 'createLocation',
      run: (c: ReturnType<typeof as>) =>
        c.post('/locations').send({ name: 'X', address: 'Y', seatingCapacity: 1 }),
    },
    {
      name: 'updateLocation',
      run: (c: ReturnType<typeof as>) => c.patch(`/locations/${venueId}`).send({ name: 'Changed' }),
    },
    {
      name: 'deleteLocation',
      run: (c: ReturnType<typeof as>) => c.delete(`/locations/${venueId}`),
    },
    {
      name: 'createEvent',
      run: (c: ReturnType<typeof as>) =>
        c.post('/events').send({
          name: 'Late',
          locationId: venueId,
          startsAt: '2026-10-02T18:00:00Z',
          endsAt: '2026-10-02T21:00:00Z',
          totalTicketCapacity: 10,
          basePrice: '5.00',
        }),
    },
    {
      name: 'updateEvent',
      run: (c: ReturnType<typeof as>) => c.patch(`/events/${eventId}`).send({ name: 'Changed' }),
    },
    { name: 'deleteEvent', run: (c: ReturnType<typeof as>) => c.delete(`/events/${eventId}`) },
  ];

  const snapshot = async () => ({
    locations: await ctx.prisma.location.findMany({ orderBy: { id: 'asc' } }),
    events: await ctx.prisma.event.findMany({ orderBy: { id: 'asc' } }),
  });

  for (const role of ['customer', 'agent'] as const) {
    it(`refuses every write from a ${role} with 403 and changes nothing`, async () => {
      const before = await snapshot();
      for (const w of writes()) {
        const res = await w.run(as(ctx, tokens[role]));
        expect({ op: w.name, status: res.status, code: res.body.error?.code }).toEqual({
          op: w.name,
          status: 403,
          code: 'FORBIDDEN',
        });
      }
      expect(await snapshot()).toEqual(before);
    });

    it(`allows every read for a ${role}`, async () => {
      const c = as(ctx, tokens[role]);
      await c.get('/locations').expect(200);
      await c.get(`/locations/${venueId}`).expect(200);
      await c.get('/events').expect(200);
      await c.get(`/events/${eventId}`).expect(200);
    });
  }

  it('refuses every read and write without a token', async () => {
    const c = anon(ctx);
    for (const res of [
      await c.get('/locations'),
      await c.get(`/locations/${venueId}`),
      await c.get('/events'),
      await c.get(`/events/${eventId}`),
      ...(await Promise.all(writes().map((w) => w.run(c)))),
    ]) {
      expect(res.status).toBe(401);
    }
  });

  it('refuses a non-admin delete of an EMPTY venue with 403, not the 409 events path', async () => {
    const { body: empty } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Empty Hall', address: '2 Arena Plaza', seatingCapacity: 100 })
      .expect(201);
    for (const role of ['customer', 'agent'] as const) {
      const res = await as(ctx, tokens[role]).delete(`/locations/${empty.id}`).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await ctx.prisma.location.findUnique({ where: { id: empty.id } })).not.toBeNull();
  });
});
