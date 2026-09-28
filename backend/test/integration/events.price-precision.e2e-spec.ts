import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * basePrice must be a decimal STRING at every layer. A JSON number would route currency
 * through binary floating point, where values like 45.10 cannot be represented exactly.
 */
describe('basePrice precision', () => {
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

  const priced = (basePrice: string, day = 1) => ({
    name: `Show ${basePrice}`,
    locationId: venueId,
    startsAt: `2026-10-0${day}T18:00:00-04:00`,
    endsAt: `2026-10-0${day}T21:00:00-04:00`,
    totalTicketCapacity: 100,
    basePrice,
  });

  it.each(['45.00', '0.00', '0.01', '19.99', '1234.56'])(
    'round-trips %s exactly as a string',
    async (price) => {
      const { body: created } = await asAdmin(ctx).post('/events').send(priced(price)).expect(201);

      expect(typeof created.basePrice).toBe('string');
      expect(created.basePrice).toBe(price);

      const { body: reread } = await asAdmin(ctx).get(`/events/${created.id}`).expect(200);
      expect(reread.basePrice).toBe(price);
    },
  );

  it('normalizes a single-decimal input to two decimals', async () => {
    const { body } = await asAdmin(ctx).post('/events').send(priced('45.1')).expect(201);
    expect(body.basePrice).toBe('45.10');
  });

  it('never emits basePrice as a JSON number in list responses', async () => {
    await asAdmin(ctx).post('/events').send(priced('19.99')).expect(201);
    const res = await asAdmin(ctx).get('/events').expect(200);
    expect(typeof res.body[0].basePrice).toBe('string');
    expect(res.text).toContain('"basePrice":"19.99"');
  });
});
