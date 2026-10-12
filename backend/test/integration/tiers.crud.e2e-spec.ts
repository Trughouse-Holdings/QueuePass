import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 004 US1 (FR-001, FR-005) — ticket tiers round-trip through real PostgreSQL. */
describe('Ticket tier CRUD', () => {
  let ctx: TestContext;
  let eventId: string;
  let otherEventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const { body: venue } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Yum Center', ...ADDRESS, seatingCapacity: 22090 })
      .expect(201);
    const event = (name: string, day: string) => ({
      name,
      locationId: venue.id,
      startsAt: `2026-11-${day}T18:00:00-05:00`,
      endsAt: `2026-11-${day}T21:00:00-05:00`,
      totalTicketCapacity: 1000,
      basePrice: '45.00',
    });
    eventId = (await asAdmin(ctx).post('/events').send(event('Season Opener', '01')).expect(201))
      .body.id;
    otherEventId = (await asAdmin(ctx).post('/events').send(event('Other', '05')).expect(201)).body
      .id;
  });

  const tiers = (id = eventId) => `/events/${id}/tiers`;

  it('creates a tier, trimming its name and returning the price as a two-decimal string', async () => {
    const res = await asAdmin(ctx)
      .post(tiers())
      .send({ name: '  VIP  ', price: '120', quantity: 100 })
      .expect(201);
    expect(res.body).toMatchObject({ eventId, name: 'VIP', price: '120.00', quantity: 100 });
    const row = await ctx.prisma.ticketTier.findUnique({ where: { id: res.body.id } });
    expect(row?.price.toString()).toBe('120');
  });

  it('lists tiers by price, lowest first, then by name', async () => {
    await asAdmin(ctx).post(tiers()).send({ name: 'VIP', price: '120.00', quantity: 100 });
    await asAdmin(ctx).post(tiers()).send({ name: 'Student', price: '20.00', quantity: 50 });
    await asAdmin(ctx).post(tiers()).send({ name: 'General', price: '45.00', quantity: 500 });
    await asAdmin(ctx).post(tiers()).send({ name: 'Balcony', price: '45.00', quantity: 100 });
    await asAdmin(ctx)
      .post(tiers(otherEventId))
      .send({ name: 'Elsewhere', price: '1', quantity: 1 });

    const res = await asAdmin(ctx).get(tiers()).expect(200);
    expect(res.body.map((t: { name: string }) => t.name)).toEqual([
      'Student',
      'Balcony',
      'General',
      'VIP',
    ]);
  });

  it('allows a free tier', async () => {
    await asAdmin(ctx)
      .post(tiers())
      .send({ name: 'Comp', price: '0', quantity: 10 })
      .expect(201)
      .expect((res) => expect(res.body.price).toBe('0.00'));
  });

  it('updates a tier', async () => {
    const { body } = await asAdmin(ctx)
      .post(tiers())
      .send({ name: 'VIP', price: '120.00', quantity: 100 });
    const res = await asAdmin(ctx)
      .patch(`${tiers()}/${body.id}`)
      .send({ name: 'Gold', price: '150.50' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Gold', price: '150.50', quantity: 100 });
  });

  it('deletes a tier, and a second delete is 404', async () => {
    const { body } = await asAdmin(ctx)
      .post(tiers())
      .send({ name: 'VIP', price: '120.00', quantity: 100 });
    await asAdmin(ctx).delete(`${tiers()}/${body.id}`).expect(204);
    await asAdmin(ctx).delete(`${tiers()}/${body.id}`).expect(404);
    await asAdmin(ctx)
      .get(tiers())
      .expect(200)
      .expect((res) => expect(res.body).toEqual([]));
  });

  it("treats another event's tier as not found", async () => {
    const { body } = await asAdmin(ctx)
      .post(tiers(otherEventId))
      .send({ name: 'VIP', price: '120.00', quantity: 100 });
    await asAdmin(ctx).patch(`${tiers()}/${body.id}`).send({ quantity: 5 }).expect(404);
    await asAdmin(ctx).delete(`${tiers()}/${body.id}`).expect(404);
  });

  it('is 404 for an unknown event', async () => {
    const missing = '7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40';
    await asAdmin(ctx).get(tiers(missing)).expect(404);
    await asAdmin(ctx)
      .post(tiers(missing))
      .send({ name: 'VIP', price: '1.00', quantity: 1 })
      .expect(404);
  });

  it("deletes an event's tiers with the event", async () => {
    await asAdmin(ctx).post(tiers()).send({ name: 'VIP', price: '120.00', quantity: 100 });
    await asAdmin(ctx).delete(`/events/${eventId}`).expect(204);
    expect(await ctx.prisma.ticketTier.count()).toBe(0);
  });

  it.each<[Record<string, unknown>, string]>([
    [{ name: 'X', price: '-1', quantity: 1 }, 'negative price'],
    [{ name: 'X', price: '1.999', quantity: 1 }, 'three decimals'],
    [{ name: 'X', price: 12, quantity: 1 }, 'price as a number'],
    [{ name: 'X', price: '1.00', quantity: 0 }, 'zero quantity'],
    [{ name: 'X', price: '1.00', quantity: 1.5 }, 'fractional quantity'],
    [{ name: '   ', price: '1.00', quantity: 1 }, 'blank name'],
    [{ name: 'x'.repeat(101), price: '1.00', quantity: 1 }, 'name too long'],
    [{ price: '1.00', quantity: 1 }, 'missing name'],
  ])('refuses %j (%s) with 400', async (body) => {
    await asAdmin(ctx).post(tiers()).send(body).expect(400);
  });

  it('refuses an empty update with 400', async () => {
    const { body } = await asAdmin(ctx)
      .post(tiers())
      .send({ name: 'VIP', price: '120.00', quantity: 100 });
    await asAdmin(ctx).patch(`${tiers()}/${body.id}`).send({}).expect(400);
  });
});
