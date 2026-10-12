import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * FR-012, FR-036 — invalid venues rejected with the failing field named.
 * Spec 013 FR-001, FR-007: the four address fields are checked before the address service is
 * asked, so a refused request never calls it.
 */
describe('Location validation', () => {
  let ctx: TestContext;
  const valid = {
    name: 'Freedom Hall',
    street: '937 Phillips Ln',
    city: 'Louisville',
    state: 'KY',
    zip: '40209',
    seatingCapacity: 19000,
  };
  const without = (key: keyof typeof valid): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...valid };
    delete copy[key];
    return copy;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.geocoder.reset();
  });

  const rejected: Array<[string, Record<string, unknown>, RegExp]> = [
    ['empty name', { ...valid, name: '' }, /name/],
    ['whitespace-only name', { ...valid, name: '   ' }, /name/],
    ['missing name', without('name'), /name/],
    ['zero capacity', { ...valid, seatingCapacity: 0 }, /seatingCapacity/],
    ['negative capacity', { ...valid, seatingCapacity: -5 }, /seatingCapacity/],
    ['fractional capacity', { ...valid, seatingCapacity: 1.5 }, /seatingCapacity/],
    ['missing street', without('street'), /street/],
    ['blank street', { ...valid, street: '   ' }, /street/],
    ['missing city', without('city'), /city/],
    ['blank city', { ...valid, city: '' }, /city/],
    ['missing state', without('state'), /state/],
    ['missing zip', without('zip'), /zip/],
    ['state ZZ', { ...valid, state: 'ZZ' }, /state/],
    ['state in lower case', { ...valid, state: 'ky' }, /state/],
    ['a territory (PR)', { ...valid, state: 'PR' }, /state/],
    ['a four-digit ZIP', { ...valid, zip: '4050' }, /zip/],
    ['a short ZIP+4', { ...valid, zip: '40507-12' }, /zip/],
    ['a 201-character street', { ...valid, street: 'S'.repeat(201) }, /street/],
    ['a 101-character city', { ...valid, city: 'C'.repeat(101) }, /city/],
    [
      'a non-boolean acceptUnverifiedAddress',
      { ...valid, acceptUnverifiedAddress: 'yes' },
      /acceptUnverifiedAddress/,
    ],
    ['the old one-line address', { ...valid, address: '937 Phillips Ln' }, /address/],
  ];

  it.each(rejected)(
    'rejects %s with VALIDATION_FAILED, naming the field, without asking the address service',
    async (_label, payload, field) => {
      const res = await asAdmin(ctx).post('/locations').send(payload).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(res.body.error.details?.fields)).toMatch(field);
      expect(ctx.geocoder.calls).toHaveLength(0);
      expect(await ctx.prisma.location.count()).toBe(0);
    },
  );

  it('trims before length-checking, so "   " fails rather than passing as length 3', async () => {
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({ ...valid, name: '   ' })
      .expect(400);
    expect(JSON.stringify(res.body.error.details)).toMatch(/name/i);
  });

  it('accepts a valid venue', async () => {
    await asAdmin(ctx).post('/locations').send(valid).expect(201);
  });

  it.each([
    ['a 200-character street', { street: 'S'.repeat(200) }],
    ['a 100-character city', { city: 'C'.repeat(100) }],
    ['a ZIP+4', { zip: '40209-1234' }],
    ['DC', { state: 'DC' }],
  ])('accepts %s (the other side of the boundary)', async (_label, change) => {
    await asAdmin(ctx)
      .post('/locations')
      .send({ ...valid, ...change })
      .expect(201);
  });
});
