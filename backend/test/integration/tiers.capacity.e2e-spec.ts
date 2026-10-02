import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 004 FR-002, FR-003, FR-004 — tier quantities never exceed the event's ticket capacity,
 * on both sides of the boundary and under genuinely concurrent requests; names are unique per
 * event ignoring case.
 */
describe('Ticket tier capacity and names', () => {
  let ctx: TestContext;
  let eventId: string;

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
      .send({ name: 'Yum Center', address: '1 Arena Plaza', seatingCapacity: 22090 })
      .expect(201);
    const { body: event } = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Season Opener',
        locationId: venue.id,
        startsAt: '2026-11-01T18:00:00-05:00',
        endsAt: '2026-11-01T21:00:00-05:00',
        totalTicketCapacity: 1000,
        basePrice: '45.00',
      })
      .expect(201);
    eventId = event.id;
  });

  const tiers = () => `/events/${eventId}/tiers`;
  const add = (name: string, quantity: number) =>
    asAdmin(ctx).post(tiers()).send({ name, price: '10.00', quantity });

  it('accepts tiers that fill the capacity exactly', async () => {
    await add('General', 800).expect(201);
    await add('VIP', 200).expect(201);
  });

  it('refuses one ticket over, saying how many remain', async () => {
    await add('General', 800).expect(201);
    const res = await add('VIP', 201).expect(409);
    expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(res.body.error.details).toEqual({
      totalTicketCapacity: 1000,
      allocated: 800,
      requested: 201,
      remaining: 200,
    });
    expect(res.body.error.message).toContain('200');
  });

  it('refuses enlarging a tier past capacity, but always allows shrinking', async () => {
    await add('General', 800).expect(201);
    const { body: vip } = await add('VIP', 200).expect(201);
    await asAdmin(ctx).patch(`${tiers()}/${vip.id}`).send({ quantity: 201 }).expect(409);
    await asAdmin(ctx).patch(`${tiers()}/${vip.id}`).send({ quantity: 150 }).expect(200);
    // The tier's own current quantity is not double-counted.
    await asAdmin(ctx).patch(`${tiers()}/${vip.id}`).send({ quantity: 200 }).expect(200);
  });

  it("refuses lowering the event's capacity below the tier total, naming it", async () => {
    await add('General', 600).expect(201);
    await add('VIP', 300).expect(201);
    const res = await asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({ totalTicketCapacity: 899 })
      .expect(409);
    expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(res.body.error.details).toEqual({ proposedTicketCapacity: 899, tierTotal: 900 });
    await asAdmin(ctx).patch(`/events/${eventId}`).send({ totalTicketCapacity: 900 }).expect(200);
  });

  it('never over-allocates under concurrent requests', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => add(`Tier ${i}`, 200)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);

    const total = await ctx.prisma.ticketTier.aggregate({
      where: { eventId },
      _sum: { quantity: true },
    });
    expect(total._sum.quantity).toBe(1000);
  });

  it('never lets a concurrent capacity cut and a tier add both succeed past the limit', async () => {
    await add('General', 500).expect(201);
    const [cut, grow] = await Promise.all([
      asAdmin(ctx).patch(`/events/${eventId}`).send({ totalTicketCapacity: 600 }),
      add('VIP', 400),
    ]);
    const event = await ctx.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const total = await ctx.prisma.ticketTier.aggregate({
      where: { eventId },
      _sum: { quantity: true },
    });
    expect(total._sum.quantity ?? 0).toBeLessThanOrEqual(event.totalTicketCapacity);
    expect([cut.status, grow.status].filter((s) => s >= 200 && s < 300).length).toBe(1);
  });

  it('refuses a duplicate name ignoring case, on create and on rename', async () => {
    await add('VIP', 10).expect(201);
    const dup = await add('  vip ', 10).expect(409);
    expect(dup.body.error.code).toBe('TIER_NAME_TAKEN');
    expect(dup.body.error.message).toContain('VIP');

    const { body: general } = await add('General', 10).expect(201);
    await asAdmin(ctx)
      .patch(`${tiers()}/${general.id}`)
      .send({ name: 'Vip' })
      .expect(409)
      .expect((res) => expect(res.body.error.code).toBe('TIER_NAME_TAKEN'));
    // Renaming a tier to its own name in a different case is fine.
    await asAdmin(ctx).patch(`${tiers()}/${general.id}`).send({ name: 'GENERAL' }).expect(200);
  });

  it('allows the same tier name on different events', async () => {
    await add('VIP', 10).expect(201);
    const { body: venue } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Freedom Hall', address: '937 Phillips Ln', seatingCapacity: 19000 });
    const { body: other } = await asAdmin(ctx).post('/events').send({
      name: 'Other',
      locationId: venue.id,
      startsAt: '2026-11-01T18:00:00-05:00',
      endsAt: '2026-11-01T21:00:00-05:00',
      totalTicketCapacity: 100,
      basePrice: '10.00',
    });
    await asAdmin(ctx)
      .post(`/events/${other.id}/tiers`)
      .send({ name: 'VIP', price: '10.00', quantity: 10 })
      .expect(201);
  });
});
