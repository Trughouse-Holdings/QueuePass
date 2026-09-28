import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** FR-020 — ticket capacity may not exceed the venue's seating capacity. */
describe('Event capacity ceiling', () => {
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
    const { body } = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Yum Center', address: '1 Arena Plaza', seatingCapacity: 22090 })
      .expect(201);
    venueId = body.id;
  });

  const withCapacity = (totalTicketCapacity: number) => ({
    name: 'Season Opener',
    locationId: venueId,
    startsAt: '2026-10-01T18:00:00-04:00',
    endsAt: '2026-10-01T21:00:00-04:00',
    totalTicketCapacity,
    basePrice: '45.00',
  });

  it('rejects capacity above the venue limit, naming the limit', async () => {
    const res = await asAdmin(ctx).post('/events').send(withCapacity(25000)).expect(409);
    expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(res.body.error.details.seatingCapacity).toBe(22090);
    expect(res.body.error.details.requestedTicketCapacity).toBe(25000);
  });

  it('accepts capacity exactly equal to the venue limit', async () => {
    await asAdmin(ctx).post('/events').send(withCapacity(22090)).expect(201);
  });

  it('accepts capacity below the venue limit', async () => {
    await asAdmin(ctx).post('/events').send(withCapacity(1)).expect(201);
  });

  it('applies the ceiling on update too', async () => {
    const { body } = await asAdmin(ctx).post('/events').send(withCapacity(1000)).expect(201);
    const res = await asAdmin(ctx)
      .patch(`/events/${body.id}`)
      .send({ totalTicketCapacity: 99999 })
      .expect(409);
    expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
  });
});
