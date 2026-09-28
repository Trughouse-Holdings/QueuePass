import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** FR-012, FR-036 — invalid venues rejected with the failing field named. */
describe('Location validation', () => {
  let ctx: TestContext;
  const valid = {
    name: 'Freedom Hall',
    address: '937 Phillips Ln, Louisville, KY',
    seatingCapacity: 19000,
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  const rejected: Array<[string, Record<string, unknown>]> = [
    ['empty name', { ...valid, name: '' }],
    ['whitespace-only name', { ...valid, name: '   ' }],
    ['missing name', { address: valid.address, seatingCapacity: valid.seatingCapacity }],
    ['empty address', { ...valid, address: '' }],
    ['whitespace-only address', { ...valid, address: '   ' }],
    ['zero capacity', { ...valid, seatingCapacity: 0 }],
    ['negative capacity', { ...valid, seatingCapacity: -5 }],
    ['fractional capacity', { ...valid, seatingCapacity: 1.5 }],
  ];

  it.each(rejected)('rejects %s with VALIDATION_FAILED', async (_label, payload) => {
    const res = await asAdmin(ctx).post('/locations').send(payload).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details?.fields).toBeDefined();
  });

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
});
