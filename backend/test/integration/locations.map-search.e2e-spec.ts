import type { MapPlace } from '../../src/address/map-search';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 013 research R16 (issue #25): when the address service vouches for no match, a place on
 * the map at the typed address, or the venue found by its name, verifies the address as typed. Every response is also checked
 * against the contract by `asAdmin`.
 */
describe('Venue address checks after the address service (spec 013 R16)', () => {
  let ctx: TestContext;
  const arena = {
    name: 'KFC Yum! Center',
    street: '1 Arena Plaza',
    city: 'Louisville',
    state: 'KY',
    zip: '40202',
    seatingCapacity: 22090,
  };
  /** The KFC Yum! Center as OpenStreetMap has it: house number 1, on a path it calls Escalator. */
  const yum: MapPlace = {
    name: 'KFC Yum! Center',
    kind: 'leisure',
    houseNumber: '1',
    state: 'KY',
    zip: '40202',
    location: PLACES.louisville,
  };
  const uofl = {
    name: 'University of Louisville',
    street: '2301 S 3rd St',
    city: 'Louisville',
    state: 'KY',
    zip: '40292',
    seatingCapacity: 500,
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
    ctx.map.reset();
  });

  describe('the map, after no match', () => {
    it('verifies a place at the typed address, saved as typed, zone from its place', async () => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next([{ ...yum, name: null }]);
      const res = await asAdmin(ctx).post('/locations').send(arena).expect(201);
      expect(res.body).toMatchObject({
        street: '1 Arena Plaza',
        city: 'Louisville',
        state: 'KY',
        zip: '40202',
        address: '1 Arena Plaza, Louisville, KY 40202',
        addressVerified: true,
        timeZone: 'America/New_York',
        timeZoneSource: 'ADDRESS',
      });
      expect(ctx.map.calls).toEqual([
        { by: 'address', street: '1 Arena Plaza', city: 'Louisville', state: 'KY' },
      ]);
    });

    it('then searches by the venue name, and verifies the place with the typed house number', async () => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next([]).next([{ ...yum, houseNumber: '2', name: 'Arena Garage' }, yum]);
      const res = await asAdmin(ctx).post('/locations').send(arena).expect(201);
      expect(res.body).toMatchObject({ street: '1 Arena Plaza', addressVerified: true });
      expect(ctx.map.calls).toEqual([
        { by: 'address', street: '1 Arena Plaza', city: 'Louisville', state: 'KY' },
        { by: 'name', name: 'KFC Yum! Center', city: 'Louisville', state: 'KY' },
      ]);
    });

    it('verifies a place with no house number on the map by the venue name (Kroger Field)', async () => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next([]).next([
        {
          name: 'Kroger Field',
          kind: 'leisure',
          houseNumber: null,
          state: 'KY',
          zip: '40506',
          location: PLACES.lexington,
        },
      ]);
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({
          name: 'Kroger Field',
          street: '1540 University Dr',
          city: 'Lexington',
          state: 'KY',
          zip: '40506',
          seatingCapacity: 61000,
        })
        .expect(201);
      expect(res.body).toMatchObject({ street: '1540 University Dr', addressVerified: true });
    });

    it('sends the street without a typed suite, and keeps the suite in what is saved', async () => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next([yum]);
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({ ...arena, street: '1 Arena Plaza Ste 200' })
        .expect(201);
      expect(ctx.map.calls[0]).toMatchObject({ street: '1 Arena Plaza' });
      expect(res.body).toMatchObject({ street: '1 Arena Plaza Ste 200', addressVerified: true });
    });

    it.each([
      ['another ZIP code', { zip: '40203' }],
      ['another state', { state: 'IN' }],
      ['another house number', { houseNumber: '10' }],
      ['no house number and another name', { houseNumber: null, name: 'Louisville Arena' }],
    ])('does not verify a place with %s: refused as before, not found', async (_label, change) => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next([{ ...yum, ...change }]).next([{ ...yum, ...change }]);
      const res = await asAdmin(ctx).post('/locations').send(arena).expect(400);
      expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
      expect(await ctx.prisma.location.count()).toBe(0);
    });

    it.each([
      ['another name at the typed number (review M1)', { name: 'Arena Garage' }],
      ['a road with the venue name', { kind: 'highway', houseNumber: null }],
    ])('does not verify, by name, %s', async (_label, change) => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next([]).next([{ ...yum, ...change }]);
      const res = await asAdmin(ctx).post('/locations').send(arena).expect(400);
      expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
    });

    it('saves anyway, not verified, when the map finds nothing either', async () => {
      ctx.geocoder.next({ kind: 'none' });
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({ ...arena, acceptUnverifiedAddress: true, timeZone: 'America/New_York' })
        .expect(201);
      expect(res.body.addressVerified).toBe(false);
      expect(ctx.map.calls).toHaveLength(2);
    });

    it('treats a map that cannot be reached as finding nothing: the address service decides', async () => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next('unavailable');
      const res = await asAdmin(ctx).post('/locations').send(arena).expect(400);
      expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
      expect(ctx.map.calls).toHaveLength(1);
    });

    it('verifies after several matches too, saved as typed', async () => {
      ctx.geocoder.next({
        kind: 'many',
        candidates: ['1 ARENA PLZ, LOUISVILLE, KY 40202', '1 ARENA PL, LOUISVILLE, KY 40202'],
      });
      ctx.map.next([yum]);
      const res = await asAdmin(ctx).post('/locations').send(arena).expect(201);
      expect(res.body).toMatchObject({ street: '1 Arena Plaza', addressVerified: true });
    });
  });

  it('never asks the map when the address service matches', async () => {
    await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Rupp Arena', ...ADDRESS, seatingCapacity: 20500 })
      .expect(201);
    expect(ctx.map.calls).toHaveLength(0);
  });

  it('never asks the map when the address service is unavailable: 503 as before', async () => {
    ctx.geocoder.next({ kind: 'unavailable' });
    const res = await asAdmin(ctx).post('/locations').send(arena).expect(503);
    expect(res.body.error.code).toBe('ADDRESS_SERVICE_UNAVAILABLE');
    expect(ctx.map.calls).toHaveLength(0);
  });

  describe('one match at another ZIP code (UofL: 40292 filed under 40208)', () => {
    const at40208 = {
      kind: 'match',
      street: '2301 S 3RD ST',
      city: 'LOUISVILLE',
      state: 'KY',
      zip: '40208',
      location: PLACES.louisville,
    } as const;
    const onMap: MapPlace = {
      name: 'University of Louisville',
      kind: 'amenity',
      houseNumber: '2301',
      state: 'KY',
      zip: '40292',
      location: PLACES.louisville,
    };

    it('is verified as typed, keeping the typed ZIP, when the map has it there', async () => {
      ctx.geocoder.next(at40208);
      ctx.map.next([onMap]);
      const res = await asAdmin(ctx).post('/locations').send(uofl).expect(201);
      expect(res.body).toMatchObject({
        street: '2301 S 3rd St',
        zip: '40292',
        address: '2301 S 3rd St, Louisville, KY 40292',
        addressVerified: true,
        timeZoneSource: 'ADDRESS',
      });
    });

    it('is refused as ambiguous, as before, when the map does not (a mistyped ZIP, review S1)', async () => {
      ctx.geocoder.next(at40208);
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({ ...uofl, zip: '40214' })
        .expect(400);
      expect(res.body.error.code).toBe('ADDRESS_AMBIGUOUS');
      expect(ctx.map.calls).toHaveLength(2);
    });
  });

  describe('on an edit', () => {
    let id: string;
    beforeEach(async () => {
      ctx.geocoder.next({ kind: 'none' });
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({ ...arena, acceptUnverifiedAddress: true, timeZone: 'America/New_York' })
        .expect(201);
      id = res.body.id;
      ctx.geocoder.reset();
      ctx.map.reset();
    });

    it('searches by the name sent with a changed address', async () => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next([]).next([{ ...yum, houseNumber: '937', zip: '40209', name: 'Freedom Hall' }]);
      const res = await asAdmin(ctx)
        .patch(`/locations/${id}`)
        .send({
          name: 'Freedom Hall',
          street: '937 Phillips Ln',
          city: 'Louisville',
          state: 'KY',
          zip: '40209',
          acceptUnverifiedAddress: true,
        })
        .expect(200);
      expect(ctx.map.calls[1]).toEqual({
        by: 'name',
        name: 'Freedom Hall',
        city: 'Louisville',
        state: 'KY',
      });
      expect(res.body).toMatchObject({ street: '937 Phillips Ln', addressVerified: true });
    });

    it('upgrades the same not-verified address resent with the flag (024 R7), by the stored name', async () => {
      ctx.geocoder.next({ kind: 'none' });
      ctx.map.next([]).next([yum]);
      const res = await asAdmin(ctx)
        .patch(`/locations/${id}`)
        .send({
          street: '1 Arena Plaza',
          city: 'Louisville',
          state: 'KY',
          zip: '40202',
          acceptUnverifiedAddress: true,
        })
        .expect(200);
      expect(ctx.map.calls[1]).toMatchObject({ by: 'name', name: 'KFC Yum! Center' });
      expect(res.body).toMatchObject({
        street: '1 Arena Plaza',
        addressVerified: true,
        timeZone: 'America/New_York',
        timeZoneSource: 'ADMIN',
      });
    });
  });
});
