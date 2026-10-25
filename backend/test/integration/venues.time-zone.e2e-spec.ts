import { STATE_TIME_ZONES, US_STATES } from '@queuepass/shared';
import { TIME_ZONE_FINDER, type TimeZoneFinder } from '../../src/address/time-zone-finder';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS, windowAt } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 020 US4 (FR-001 to FR-008, SC-006; research R1, R3, R4, R7): every venue gets a zone, worked
 * out by the Backend. Every response is checked against the contract by `asAdmin`, and carries
 * `timeZone` and `timeZoneSource`.
 */
describe('Venue time zone (spec 020 US4)', () => {
  let ctx: TestContext;
  let finder: TimeZoneFinder;

  const lexington = { name: 'Rupp Arena', ...ADDRESS, seatingCapacity: 20500 };
  const phoenix = {
    name: 'Phoenix Hall',
    street: '201 E Jefferson St',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85004',
    seatingCapacity: 500,
  };
  const ohio = {
    name: 'Columbus Hall',
    street: '1 Nowhere Blvd',
    city: 'Columbus',
    state: 'OH',
    zip: '43215',
    seatingCapacity: 300,
  };
  const louisville = {
    name: 'KFC Yum! Center',
    street: '1 Arena Plaza',
    city: 'Louisville',
    state: 'KY',
    zip: '40202',
    seatingCapacity: 22090,
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    finder = ctx.app.get(TIME_ZONE_FINDER);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.geocoder.reset();
    jest.restoreAllMocks();
  });

  const create = (body: object) => asAdmin(ctx).post('/locations').send(body);
  const zoneOf = async (id: string) =>
    ctx.prisma.location.findUniqueOrThrow({
      where: { id },
      select: { timeZone: true, timeZoneSource: true },
    });

  describe('create', () => {
    it('a verified address in Lexington is Eastern, from the address', async () => {
      const res = await create(lexington).expect(201);
      expect(res.body).toMatchObject({ timeZone: 'America/New_York', timeZoneSource: 'ADDRESS' });
    });

    it('a verified address in Phoenix is Arizona time, from the address', async () => {
      ctx.geocoder.placeAt(PLACES.phoenix);
      const res = await create(phoenix).expect(201);
      expect(res.body).toMatchObject({ timeZone: 'America/Phoenix', timeZoneSource: 'ADDRESS' });
    });

    it('a verified address in Honolulu is Hawaii time', async () => {
      ctx.geocoder.placeAt(PLACES.honolulu);
      const res = await create({
        name: 'Ward Hall',
        street: '777 Ward Ave',
        city: 'Honolulu',
        state: 'HI',
        zip: '96814',
        seatingCapacity: 100,
      }).expect(201);
      expect(res.body).toMatchObject({ timeZone: 'Pacific/Honolulu', timeZoneSource: 'ADDRESS' });
    });

    it.each([
      ['no place', null],
      ['a place with no zone on the list', PLACES.atlantic],
    ])('a verified match with %s in Ohio is Eastern, from the state', async (_label, place) => {
      ctx.geocoder.placeAt(place);
      const res = await create(ohio).expect(201);
      expect(res.body).toMatchObject({ timeZone: 'America/New_York', timeZoneSource: 'STATE' });
    });

    it.each([
      ['no place', null],
      ['a place with no zone on the list', PLACES.atlantic],
    ])(
      'a verified match with %s in Kentucky is 400 TIME_ZONE_REQUIRED, nothing saved',
      async (_label, place) => {
        ctx.geocoder.placeAt(place);
        const res = await create(lexington).expect(400);
        expect(res.body.error).toEqual({
          code: 'TIME_ZONE_REQUIRED',
          message:
            "Kentucky has more than one time zone. Choose this venue's time zone: Eastern Time " +
            'or Central Time.',
          details: { state: 'KY', timeZones: ['America/New_York', 'America/Chicago'] },
        });
        expect(await ctx.prisma.location.count()).toBe(0);
      },
    );

    it('save anyway in Ohio is Eastern, from the state', async () => {
      ctx.geocoder.always({ kind: 'none' });
      const res = await create({ ...ohio, acceptUnverifiedAddress: true }).expect(201);
      expect(res.body).toMatchObject({
        addressVerified: false,
        timeZone: 'America/New_York',
        timeZoneSource: 'STATE',
      });
    });

    it('save anyway in Kentucky needs a zone; with one it is saved, chosen by an admin', async () => {
      ctx.geocoder.always({ kind: 'none' });
      const refused = await create({ ...louisville, acceptUnverifiedAddress: true }).expect(400);
      expect(refused.body.error.code).toBe('TIME_ZONE_REQUIRED');
      expect(await ctx.prisma.location.count()).toBe(0);

      const res = await create({
        ...louisville,
        acceptUnverifiedAddress: true,
        timeZone: 'America/New_York',
      }).expect(201);
      expect(res.body).toMatchObject({
        addressVerified: false,
        timeZone: 'America/New_York',
        timeZoneSource: 'ADMIN',
      });
    });

    const split = US_STATES.filter((s) => STATE_TIME_ZONES[s.code].length > 1);
    const single = US_STATES.filter((s) => STATE_TIME_ZONES[s.code].length === 1);

    it('has 15 split states and 36 one-zone ones', () => {
      expect([split.length, single.length]).toEqual([15, 36]);
    });

    it.each(split.map((s) => [s.code, STATE_TIME_ZONES[s.code]] as const))(
      'save anyway in split state %s is TIME_ZONE_REQUIRED listing %j',
      async (state, zones) => {
        ctx.geocoder.always({ kind: 'none' });
        const res = await create({ ...ohio, state, acceptUnverifiedAddress: true }).expect(400);
        expect(res.body.error.code).toBe('TIME_ZONE_REQUIRED');
        expect(res.body.error.details).toEqual({ state, timeZones: zones });
      },
    );

    it.each(single.map((s) => [s.code, STATE_TIME_ZONES[s.code][0]] as const))(
      'save anyway in %s gives %s, from the state',
      async (state, zone) => {
        ctx.geocoder.always({ kind: 'none' });
        const res = await create({ ...ohio, state, acceptUnverifiedAddress: true }).expect(201);
        expect(res.body).toMatchObject({ timeZone: zone, timeZoneSource: 'STATE' });
      },
    );

    it('without save anyway, an unmatched Kentucky address is still ADDRESS_NOT_FOUND', async () => {
      ctx.geocoder.always({ kind: 'none' });
      const res = await create(louisville).expect(400);
      expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
    });

    it("a sent zone wins over the address's, as ADMIN", async () => {
      const res = await create({ ...lexington, timeZone: 'America/Chicago' }).expect(201);
      expect(res.body).toMatchObject({ timeZone: 'America/Chicago', timeZoneSource: 'ADMIN' });
    });

    it.each(['America/Kentucky/Louisville', 'UTC', '', 5])(
      'refuses timeZone %j with 400 VALIDATION_FAILED',
      async (timeZone) => {
        const res = await create({ ...lexington, timeZone }).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(res.body.error)).toContain('timeZone');
        expect(await ctx.prisma.location.count()).toBe(0);
      },
    );
  });

  describe('update', () => {
    const patch = (id: string, body: object) => asAdmin(ctx).patch(`/locations/${id}`).send(body);

    it('name-only and capacity-only edits never change the zone or ask the finder', async () => {
      const { body: v } = await create({ ...lexington, timeZone: 'America/Chicago' }).expect(201);
      const spy = jest.spyOn(finder, 'zoneAt');
      await patch(v.id, { name: 'Renamed' }).expect(200);
      await patch(v.id, { seatingCapacity: 20000 }).expect(200);
      // The same address, in another case, is not a change (spec 013 FR-008).
      await patch(v.id, { ...ADDRESS, street: '430 w vine st' }).expect(200);
      expect(spy).not.toHaveBeenCalled();
      expect(await zoneOf(v.id)).toEqual({
        timeZone: 'America/Chicago',
        timeZoneSource: 'ADMIN',
      });
    });

    it('an address change works the zone out again (no events: it simply changes)', async () => {
      const { body: v } = await create(lexington).expect(201);
      ctx.geocoder.placeAt(PLACES.phoenix);
      const { name: _n, seatingCapacity: _c, ...address } = phoenix;
      const res = await patch(v.id, address).expect(200);
      expect(res.body).toMatchObject({ timeZone: 'America/Phoenix', timeZoneSource: 'ADDRESS' });
    });

    it('timeZone alone on a venue without events changes it, as ADMIN', async () => {
      const { body: v } = await create(lexington).expect(201);
      const res = await patch(v.id, { timeZone: 'America/Denver' }).expect(200);
      expect(res.body).toMatchObject({ timeZone: 'America/Denver', timeZoneSource: 'ADMIN' });
    });

    it('the same zone as stored moves no event and records ADMIN', async () => {
      const { body: v } = await create(lexington).expect(201);
      const w = windowAt(30);
      const { body: e } = await asAdmin(ctx)
        .post('/events')
        .send({ name: 'Show', locationId: v.id, ...w, totalTicketCapacity: 10, basePrice: '1.00' })
        .expect(201);
      const res = await patch(v.id, { timeZone: 'America/New_York' }).expect(200);
      expect(res.body).toMatchObject({ timeZone: 'America/New_York', timeZoneSource: 'ADMIN' });
      const after = await ctx.prisma.event.findUniqueOrThrow({ where: { id: e.id } });
      expect(after.startsAt.toISOString()).toBe(e.startsAt);
      expect(after.endsAt.toISOString()).toBe(e.endsAt);
    });

    it('timeZone with an address change: the sent zone wins', async () => {
      const { body: v } = await create(lexington).expect(201);
      ctx.geocoder.placeAt(PLACES.phoenix);
      const { name: _n, seatingCapacity: _c, ...address } = phoenix;
      const res = await patch(v.id, { ...address, timeZone: 'America/Los_Angeles' }).expect(200);
      expect(res.body).toMatchObject({
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'ADMIN',
      });
    });

    it('a pre-013 venue keeps its zone on a name edit and re-derives when given four parts', async () => {
      const legacy = await ctx.prisma.location.create({
        data: {
          name: 'Old Hall',
          address: '1 Main St, Somewhere',
          seatingCapacity: 100,
          timeZone: 'America/New_York',
          timeZoneSource: 'DEFAULT',
        },
      });
      await patch(legacy.id, { name: 'Old Hall 2' }).expect(200);
      expect(await zoneOf(legacy.id)).toEqual({
        timeZone: 'America/New_York',
        timeZoneSource: 'DEFAULT',
      });
      ctx.geocoder.placeAt(PLACES.phoenix);
      const { name: _n, seatingCapacity: _c, ...address } = phoenix;
      const res = await patch(legacy.id, address).expect(200);
      expect(res.body).toMatchObject({ timeZone: 'America/Phoenix', timeZoneSource: 'ADDRESS' });
    });

    it('an ADMIN venue whose new address derives the same zone becomes ADDRESS (m1)', async () => {
      const { body: v } = await create({ ...lexington, timeZone: 'America/New_York' }).expect(201);
      expect(v.timeZoneSource).toBe('ADMIN');
      const res = await patch(v.id, {
        street: '937 Phillips Ln',
        city: 'Louisville',
        state: 'KY',
        zip: '40209',
      }).expect(200);
      expect(res.body).toMatchObject({ timeZone: 'America/New_York', timeZoneSource: 'ADDRESS' });
    });

    it('with timeZone sent too, it stays ADMIN', async () => {
      const { body: v } = await create({ ...lexington, timeZone: 'America/New_York' }).expect(201);
      const res = await patch(v.id, {
        street: '937 Phillips Ln',
        city: 'Louisville',
        state: 'KY',
        zip: '40209',
        timeZone: 'America/New_York',
      }).expect(200);
      expect(res.body).toMatchObject({ timeZone: 'America/New_York', timeZoneSource: 'ADMIN' });
    });

    it('refuses timeZone off the list with 400 VALIDATION_FAILED', async () => {
      const { body: v } = await create(lexington).expect(201);
      const res = await patch(v.id, { timeZone: 'America/Kentucky/Louisville' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  it('every venue response carries timeZone and timeZoneSource', async () => {
    const { body: v } = await create(lexington).expect(201);
    const one = await asAdmin(ctx).get(`/locations/${v.id}`).expect(200);
    const all = await asAdmin(ctx).get('/locations').expect(200);
    for (const venue of [one.body, ...all.body]) {
      expect(venue.timeZone).toBe('America/New_York');
      expect(venue.timeZoneSource).toBe('ADDRESS');
    }
  });
});
