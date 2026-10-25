import { HttpException } from '@nestjs/common';
import { LocationsService } from '../../src/locations/locations.service';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
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

  it('saves the corrected parts when the service corrects the city', async () => {
    ctx.geocoder.next({
      kind: 'match',
      street: '2301 S 3RD ST',
      city: 'LOUISVILLE',
      state: 'KY',
      zip: '40208',
      location: PLACES.louisville,
    });
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({
        ...venue,
        street: '2301 South 3rd Street',
        city: 'Louisvile',
        state: 'KY',
        zip: '40208',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      street: '2301 S 3RD ST',
      city: 'LOUISVILLE',
      zip: '40208',
      address: '2301 S 3RD ST, LOUISVILLE, KY 40208',
      addressVerified: true,
    });
  });

  describe('one match that moves the ZIP code or house number (FR-021)', () => {
    const kroger = {
      name: 'Kroger Field',
      street: '1540 University Dr',
      city: 'Lexington',
      state: 'KY',
      zip: '40508',
      seatingCapacity: 61000,
    };
    const moved = {
      kind: 'match',
      street: '1540 UNIVERSITY CT',
      city: 'LEXINGTON',
      state: 'KY',
      zip: '40503',
      location: PLACES.louisville,
    } as const;

    it('refuses a match with another ZIP code as ambiguous, offering it, nothing saved', async () => {
      ctx.geocoder.next(moved);
      const res = await asAdmin(ctx).post('/locations').send(kroger).expect(400);
      expect(res.body.error).toEqual({
        code: 'ADDRESS_AMBIGUOUS',
        message:
          'We found a different US address for 1540 University Dr, Lexington, KY 40508. ' +
          'Did you mean this one? Enter it to use it.',
        details: {
          address: '1540 University Dr, Lexington, KY 40508',
          candidates: ['1540 UNIVERSITY CT, LEXINGTON, KY 40503'],
        },
      });
      expect(await ctx.prisma.location.count()).toBe(0);
    });

    it('refuses a match with another house number as ambiguous', async () => {
      ctx.geocoder.next({ ...moved, street: '1504 UNIVERSITY DR', zip: '40508' });
      const res = await asAdmin(ctx).post('/locations').send(kroger).expect(400);
      expect(res.body.error.code).toBe('ADDRESS_AMBIGUOUS');
      expect(res.body.error.details.candidates).toEqual([
        '1504 UNIVERSITY DR, LEXINGTON, KY 40508',
      ]);
      expect(await ctx.prisma.location.count()).toBe(0);
    });

    it('saves anyway what was typed, not verified', async () => {
      ctx.geocoder.next(moved);
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({ ...kroger, acceptUnverifiedAddress: true })
        .expect(201);
      expect(res.body).toMatchObject({
        address: '1540 University Dr, Lexington, KY 40508',
        street: '1540 University Dr',
        zip: '40508',
        addressVerified: false,
      });
    });

    it('accepts the match once the admin enters it', async () => {
      ctx.geocoder.next(moved);
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({ ...kroger, street: '1540 University Ct', zip: '40503' })
        .expect(201);
      expect(res.body).toMatchObject({
        address: '1540 UNIVERSITY CT, LEXINGTON, KY 40503',
        addressVerified: true,
      });
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

  describe('when the address service is unavailable (US2, FR-006)', () => {
    const UNAVAILABLE = {
      code: 'ADDRESS_SERVICE_UNAVAILABLE',
      message: "We can't verify the address right now. Nothing was saved. Try again in a minute.",
    };

    it('refuses with 503 and the exact message, no cause revealed, nothing saved', async () => {
      ctx.geocoder.next({ kind: 'unavailable' });
      const res = await asAdmin(ctx).post('/locations').send(venue).expect(503);
      expect(res.body).toEqual({ error: UNAVAILABLE });
      expect(await ctx.prisma.location.count()).toBe(0);
    });

    it('ignores save anyway: still 503, nothing saved', async () => {
      ctx.geocoder.next({ kind: 'unavailable' });
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({ ...arena, acceptUnverifiedAddress: true })
        .expect(503);
      expect(res.body.error.code).toBe('ADDRESS_SERVICE_UNAVAILABLE');
      expect(await ctx.prisma.location.count()).toBe(0);
    });

    it('saves as sent, not verified, only through the internal option (research R14)', async () => {
      ctx.geocoder.always({ kind: 'unavailable' });
      const service = ctx.app.get(LocationsService);
      const saved = await service.create(
        { ...arena, street: ' 1  Arena Plaza ' },
        { whenServiceUnavailable: 'saveUnverified' },
      );
      expect(saved).toMatchObject({
        street: '1 Arena Plaza',
        address: '1 Arena Plaza, Louisville, KY 40202',
        addressVerified: false,
      });
      expect(await ctx.prisma.location.count()).toBe(1);
    });

    it('refuses through the service without the internal option', async () => {
      ctx.geocoder.always({ kind: 'unavailable' });
      const service = ctx.app.get(LocationsService);
      const refused = await service.create(arena).catch((err: unknown) => err);
      expect(refused).toBeInstanceOf(HttpException);
      expect((refused as HttpException).getStatus()).toBe(503);
      expect((refused as HttpException).getResponse()).toEqual({ error: UNAVAILABLE });
      expect(await ctx.prisma.location.count()).toBe(0);
    });
  });
});
