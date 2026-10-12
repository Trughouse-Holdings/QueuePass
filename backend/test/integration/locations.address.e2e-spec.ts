import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 013 US1 on create: FR-002 to FR-005, FR-007, FR-019; research R2, R3. Every response is
 * also checked against the contract by `asAdmin`.
 */
describe('Venue address check on create (spec 013)', () => {
  let ctx: TestContext;
  const venue = { name: 'Rupp Arena', ...ADDRESS, seatingCapacity: 20500 };
  const arena = {
    name: 'KFC Yum! Center',
    street: '1 Arena Plaza',
    city: 'Louisville',
    state: 'KY',
    zip: '40202',
    seatingCapacity: 22090,
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

  it('refuses an address with no match: 400 ADDRESS_NOT_FOUND, nothing saved', async () => {
    ctx.geocoder.next({ kind: 'none' });
    const res = await asAdmin(ctx).post('/locations').send(arena).expect(400);
    expect(res.body.error).toEqual({
      code: 'ADDRESS_NOT_FOUND',
      message:
        "We couldn't find 1 Arena Plaza, Louisville, KY 40202 as a US address. Check the " +
        'street, city, state, and ZIP code.',
      details: { address: '1 Arena Plaza, Louisville, KY 40202' },
    });
    expect(await ctx.prisma.location.count()).toBe(0);
  });

  it('refuses an address with several matches: 400 ADDRESS_AMBIGUOUS listing them', async () => {
    const candidates = [
      '100 N MAIN ST, SPRINGFIELD, IL 62701',
      '100 S MAIN ST, SPRINGFIELD, IL 62701',
    ];
    ctx.geocoder.next({ kind: 'many', candidates });
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({ ...venue, street: '100 Main St', city: 'Springfield', state: 'IL', zip: '62701' })
      .expect(400);
    expect(res.body.error).toEqual({
      code: 'ADDRESS_AMBIGUOUS',
      message:
        '100 Main St, Springfield, IL 62701 matches more than one US address. Enter one of these.',
      details: { address: '100 Main St, Springfield, IL 62701', candidates },
    });
    expect(await ctx.prisma.location.count()).toBe(0);
  });

  it('saves anyway after no match: as typed, whitespace collapsed, ZIP cut, not verified', async () => {
    ctx.geocoder.next({ kind: 'none' });
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({
        ...arena,
        street: ' 1  Arena Plaza ',
        zip: '40202-1234',
        acceptUnverifiedAddress: true,
      })
      .expect(201);
    expect(ctx.geocoder.calls).toHaveLength(1);
    expect(res.body).toMatchObject({
      street: '1 Arena Plaza',
      city: 'Louisville',
      state: 'KY',
      zip: '40202',
      address: '1 Arena Plaza, Louisville, KY 40202',
      addressVerified: false,
    });
    const row = await ctx.prisma.location.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.addressVerified).toBe(false);
    expect(row.street).toBe('1 Arena Plaza');
  });

  it('saves anyway after several matches: as typed, not verified', async () => {
    ctx.geocoder.next({ kind: 'many', candidates: ['A', 'B'] });
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({ ...arena, acceptUnverifiedAddress: true })
      .expect(201);
    expect(res.body).toMatchObject({
      address: '1 Arena Plaza, Louisville, KY 40202',
      addressVerified: false,
    });
  });

  it('ignores save anyway when the address matches: standard form, verified', async () => {
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({ ...venue, acceptUnverifiedAddress: true })
      .expect(201);
    expect(ctx.geocoder.calls).toHaveLength(1);
    expect(res.body).toMatchObject({
      address: '430 W VINE ST, LEXINGTON, KY 40507',
      addressVerified: true,
    });
  });

  it('treats acceptUnverifiedAddress: false like no flag', async () => {
    ctx.geocoder.next({ kind: 'none' });
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({ ...arena, acceptUnverifiedAddress: false })
      .expect(400);
    expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
    expect(await ctx.prisma.location.count()).toBe(0);
  });

  it('saves the corrected parts when the service corrects a field', async () => {
    ctx.geocoder.next({
      kind: 'match',
      street: '2301 S 3RD ST',
      city: 'LOUISVILLE',
      state: 'KY',
      zip: '40208',
    });
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({ ...venue, street: '2301 S 3rd St', city: 'Louisvile', state: 'KY', zip: '40292' })
      .expect(201);
    expect(res.body).toMatchObject({
      street: '2301 S 3RD ST',
      city: 'LOUISVILLE',
      zip: '40208',
      address: '2301 S 3RD ST, LOUISVILLE, KY 40208',
      addressVerified: true,
    });
  });

  it('sends a ZIP+4 to the service as 5 digits and stores 5', async () => {
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({ ...venue, zip: '40507-1234' })
      .expect(201);
    expect(ctx.geocoder.calls[0].zip).toBe('40507');
    expect(res.body.zip).toBe('40507');
  });

  it('refuses a bad field before asking the service (FR-007)', async () => {
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({ ...venue, seatingCapacity: 0 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(ctx.geocoder.calls).toHaveLength(0);
  });
});
