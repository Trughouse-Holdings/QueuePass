import { asAdmin } from '../setup/authed-request';
import { PLACES, type FakeAnswer } from '../setup/fake-geocoder';
import { ADDRESS, event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 013 US1 on edit: FR-007, FR-008, FR-009, FR-019; research R7. Name-only and unchanged
 * edits never ask the address service, except a not-verified venue's same address resent with
 * the flag, which is checked again (spec 024 FR-016, research R7); a changed address is checked with no lock held, and the
 * write re-checks capacity under the venue lock, so a slow lookup cannot break capacity.
 */
describe('Venue address check on edit (spec 013)', () => {
  let ctx: TestContext;
  let id: string;
  const moved = { street: '937 Phillips Ln', city: 'Louisville', state: 'KY', zip: '40209' };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.geocoder.reset();
    id = await venue(ctx, 'Rupp Arena');
    ctx.geocoder.reset();
  });

  const patch = (body: object, venueId = id) =>
    asAdmin(ctx).patch(`/locations/${venueId}`).send(body);
  const row = () => ctx.prisma.location.findUniqueOrThrow({ where: { id } });

  /** A venue saved anyway: parts as typed, not verified. */
  async function savedAnyway(): Promise<string> {
    ctx.geocoder.next({ kind: 'none' });
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({
        name: 'KFC Yum! Center',
        street: '1 Arena Plaza',
        city: 'Louisville',
        state: 'KY',
        zip: '40202',
        seatingCapacity: 22090,
        acceptUnverifiedAddress: true,
        timeZone: 'America/New_York',
      })
      .expect(201);
    ctx.geocoder.reset();
    return res.body.id;
  }

  it.each([
    ['name only', { name: 'Rupp Arena at Central Bank Center' }],
    ['capacity only', { seatingCapacity: 18000 }],
  ])('saves a %s edit without asking the service (FR-008)', async (_label, body) => {
    const before = await row();
    await patch(body).expect(200);
    expect(ctx.geocoder.calls).toHaveLength(0);
    const after = await row();
    expect(after.address).toBe(before.address);
    expect(after.addressVerified).toBe(true);
  });

  it.each([
    ['other case and spacing', { ...ADDRESS, street: ' 430  w vine ST ', city: 'LEXINGTON ' }],
    ['the same ZIP as ZIP+4', { ...ADDRESS, zip: '40507-1234' }],
  ])('treats the same address in %s as unchanged', async (_label, body) => {
    const before = await row();
    await patch(body).expect(200);
    expect(ctx.geocoder.calls).toHaveLength(0);
    const after = await row();
    expect(after).toMatchObject({
      street: before.street,
      city: before.city,
      state: before.state,
      zip: before.zip,
      address: before.address,
      addressVerified: true,
    });
  });

  it('checks a changed street once and saves the match in standard form, verified', async () => {
    const res = await patch({ ...ADDRESS, street: '431 W Vine St' }).expect(200);
    expect(ctx.geocoder.calls).toHaveLength(1);
    expect(res.body).toMatchObject({
      street: '431 W VINE ST',
      address: '431 W VINE ST, LEXINGTON, KY 40507',
      addressVerified: true,
    });
  });

  it.each<[string, FakeAnswer, string]>([
    ['no match', { kind: 'none' }, 'ADDRESS_NOT_FOUND'],
    ['several matches', { kind: 'many', candidates: ['A', 'B'] }, 'ADDRESS_AMBIGUOUS'],
  ])('refuses a changed address with %s and leaves the venue unchanged', async (_l, a, code) => {
    const before = await row();
    ctx.geocoder.next(a);
    const res = await patch({ ...moved, name: 'Renamed' }).expect(400);
    expect(res.body.error.code).toBe(code);
    expect(await row()).toEqual(before);
  });

  it('refuses a changed address whose one match moves the ZIP code, venue unchanged (FR-021)', async () => {
    const before = await row();
    ctx.geocoder.next({
      kind: 'match',
      street: '937 PHILLIPS LN',
      city: 'LOUISVILLE',
      state: 'KY',
      zip: '40213',
      location: PLACES.louisville,
    });
    const res = await patch(moved).expect(400);
    expect(res.body.error.code).toBe('ADDRESS_AMBIGUOUS');
    expect(res.body.error.details.candidates).toEqual(['937 PHILLIPS LN, LOUISVILLE, KY 40213']);
    expect(await row()).toEqual(before);
  });

  it('saves anyway a changed address whose one match moves the house number', async () => {
    ctx.geocoder.next({
      kind: 'match',
      street: '973 PHILLIPS LN',
      city: 'LOUISVILLE',
      state: 'KY',
      zip: '40209',
      location: PLACES.louisville,
    });
    const res = await patch({
      ...moved,
      acceptUnverifiedAddress: true,
      timeZone: 'America/New_York',
    }).expect(200);
    expect(res.body).toMatchObject({
      address: '937 Phillips Ln, Louisville, KY 40209',
      addressVerified: false,
    });
  });

  it('saves a changed address anyway after no match: as typed, not verified', async () => {
    ctx.geocoder.next({ kind: 'none' });
    const res = await patch({
      ...moved,
      acceptUnverifiedAddress: true,
      timeZone: 'America/New_York',
    }).expect(200);
    expect(res.body).toMatchObject({
      street: '937 Phillips Ln',
      city: 'Louisville',
      address: '937 Phillips Ln, Louisville, KY 40209',
      addressVerified: false,
    });
  });

  describe('a venue saved anyway', () => {
    it('stays not verified on a name-only edit, without asking the service', async () => {
      const anyway = await savedAnyway();
      const res = await patch({ name: 'Yum!' }, anyway).expect(200);
      expect(ctx.geocoder.calls).toHaveLength(0);
      expect(res.body.addressVerified).toBe(false);
    });

    it('becomes verified when its address is changed to one the service matches', async () => {
      const anyway = await savedAnyway();
      const res = await patch(moved, anyway).expect(200);
      expect(ctx.geocoder.calls).toHaveLength(1);
      expect(res.body).toMatchObject({
        address: '937 PHILLIPS LN, LOUISVILLE, KY 40209',
        addressVerified: true,
      });
    });
  });

  /** The saved-anyway venue's four fields, resent in other case and spacing. */
  const SAME_AGAIN = { street: '1 ARENA  PLAZA', city: 'louisville', state: 'KY', zip: '40202' };

  describe('re-check of the same address on a not-verified venue (024 R7)', () => {
    const rowOf = (venueId: string) =>
      ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } });

    it('saves a match verified, in standard form, keeping the zone and its source', async () => {
      const anyway = await savedAnyway();
      ctx.geocoder.next({
        kind: 'match',
        street: '1 ARENA PLAZA',
        city: 'LOUISVILLE',
        state: 'KY',
        zip: '40202',
        // A place in another zone: the re-check never decides the zone.
        location: PLACES.chicago,
      });
      const res = await patch(
        { ...SAME_AGAIN, acceptUnverifiedAddress: true, name: 'Yum! Center' },
        anyway,
      ).expect(200);
      expect(ctx.geocoder.calls).toHaveLength(1);
      expect(res.body).toMatchObject({
        name: 'Yum! Center',
        street: '1 ARENA PLAZA',
        city: 'LOUISVILLE',
        address: '1 ARENA PLAZA, LOUISVILLE, KY 40202',
        addressVerified: true,
        timeZone: 'America/New_York',
        timeZoneSource: 'ADMIN',
      });
      expect(await rowOf(anyway)).toMatchObject({ addressVerified: true, timeZoneSource: 'ADMIN' });
    });

    it.each<[string, FakeAnswer]>([
      ['no match', { kind: 'none' }],
      ['several matches', { kind: 'many', candidates: ['A', 'B'] }],
      [
        'a match at another ZIP code',
        {
          kind: 'match',
          street: '1 ARENA PLAZA',
          city: 'LOUISVILLE',
          state: 'KY',
          zip: '40203',
          location: PLACES.louisville,
        },
      ],
      ['the service unavailable', { kind: 'unavailable' }],
    ])('with %s, keeps the stored address, not verified, and saves the rest', async (_l, a) => {
      const anyway = await savedAnyway();
      const before = await rowOf(anyway);
      ctx.geocoder.next(a);
      const res = await patch(
        { ...SAME_AGAIN, acceptUnverifiedAddress: true, name: 'Yum! Center' },
        anyway,
      ).expect(200);
      expect(ctx.geocoder.calls).toHaveLength(1);
      expect(res.body.name).toBe('Yum! Center');
      expect(await rowOf(anyway)).toMatchObject({
        street: before.street,
        city: before.city,
        state: before.state,
        zip: before.zip,
        address: '1 Arena Plaza, Louisville, KY 40202',
        addressVerified: false,
        timeZone: before.timeZone,
        timeZoneSource: before.timeZoneSource,
      });
    });

    it('without the flag, does not ask the service (unchanged, SC-005)', async () => {
      const anyway = await savedAnyway();
      const res = await patch(SAME_AGAIN, anyway).expect(200);
      expect(ctx.geocoder.calls).toHaveLength(0);
      expect(res.body.addressVerified).toBe(false);
    });

    it('on a verified venue, does not ask the service, even with the flag', async () => {
      await patch({ ...ADDRESS, acceptUnverifiedAddress: true }).expect(200);
      expect(ctx.geocoder.calls).toHaveLength(0);
      expect((await row()).addressVerified).toBe(true);
    });

    it('drops the upgrade when another edit changed the address during the lookup', async () => {
      const anyway = await savedAnyway();
      const gate = ctx.geocoder.pause();
      const slow = patch(
        { ...SAME_AGAIN, acceptUnverifiedAddress: true, name: 'Yum! Center' },
        anyway,
      ).then((r) => r);
      await gate.started;
      // The other edit's lookup answers no match; it is saved anyway, not verified.
      ctx.geocoder.next({ kind: 'none' });
      await patch(
        { ...moved, acceptUnverifiedAddress: true, timeZone: 'America/New_York' },
        anyway,
      ).expect(200);
      // The paused re-check then finds its address.
      ctx.geocoder.next({
        kind: 'match',
        street: '1 ARENA PLAZA',
        city: 'LOUISVILLE',
        state: 'KY',
        zip: '40202',
        location: PLACES.louisville,
      });
      gate.release();
      const res = await slow;
      expect(res.status).toBe(200);
      expect(await rowOf(anyway)).toMatchObject({
        name: 'Yum! Center',
        street: '937 Phillips Ln',
        address: '937 Phillips Ln, Louisville, KY 40209',
        addressVerified: false,
      });
    });
  });

  it.each([
    ['one field', { street: '1 Main St' }],
    ['two fields', { street: '1 Main St', city: 'Louisville' }],
    ['three fields', { street: '1 Main St', city: 'Louisville', state: 'KY' }],
    ['the flag alone', { acceptUnverifiedAddress: true }],
    ['the flag with only a name', { name: 'X', acceptUnverifiedAddress: true }],
  ])('refuses %s with 400, without asking the service (FR-009, FR-019)', async (_l, body) => {
    const res = await patch(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body.error.details.fields)).toMatch(
      /street, city, state, and zip|acceptUnverifiedAddress/,
    );
    expect(ctx.geocoder.calls).toHaveLength(0);
  });

  it.each([
    ['all four null', { street: null, city: null, state: null, zip: null }],
    ['one null among values', { ...moved, city: null }],
    ['a null flag with the four', { ...moved, acceptUnverifiedAddress: null }],
    ['a null flag alone', { acceptUnverifiedAddress: null }],
  ])('refuses %s with 400 VALIDATION_FAILED, without asking the service', async (_l, body) => {
    const before = await row();
    const res = await patch(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(ctx.geocoder.calls).toHaveLength(0);
    expect(await row()).toEqual(before);
  });

  it('refuses a capacity below an event first: 409, without asking the service', async () => {
    await event(ctx, id, { capacity: 900 });
    const res = await patch({ ...moved, seatingCapacity: 500 }).expect(409);
    expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(ctx.geocoder.calls).toHaveLength(0);
  });

  it('refuses a capacity on a laid-out venue first: 400, without asking the service', async () => {
    await asAdmin(ctx)
      .put(`/locations/${id}/layout`)
      .send({ sections: [{ name: 'A', rows: 2, seatsPerRow: 10 }] })
      .expect(200);
    const res = await patch({ ...moved, seatingCapacity: 500 }).expect(400);
    expect(JSON.stringify(res.body.error.details.fields)).toMatch(/seating layout/);
    expect(ctx.geocoder.calls).toHaveLength(0);
  });

  describe('concurrency during a slow lookup (research R7)', () => {
    it('re-checks the layout rule after a layout saved during the lookup', async () => {
      const gate = ctx.geocoder.pause();
      const slow = patch({ ...moved, seatingCapacity: 500 }).then((r) => r);
      await gate.started;
      await asAdmin(ctx)
        .put(`/locations/${id}/layout`)
        .send({ sections: [{ name: 'A', rows: 10, seatsPerRow: 30 }] })
        .expect(200);
      gate.release();
      const res = await slow;
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error.details.fields)).toMatch(/seating layout/);
      const after = await row();
      expect(after.seatingCapacity).toBe(300);
      const layout = await asAdmin(ctx).get(`/locations/${id}/layout`).expect(200);
      expect(layout.body.totalSeats).toBe(300);
    });

    it('re-checks event capacity after an event is raised during the lookup', async () => {
      await patch({ seatingCapacity: 1000 }).expect(200);
      const eventId = await event(ctx, id, { name: 'Opener', capacity: 100 });
      const gate = ctx.geocoder.pause();
      const slow = patch({ ...moved, seatingCapacity: 200 }).then((r) => r);
      await gate.started;
      await asAdmin(ctx).patch(`/events/${eventId}`).send({ totalTicketCapacity: 400 }).expect(200);
      gate.release();
      const res = await slow;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.details.conflictingEvent.name).toBe('Opener');
      expect((await row()).seatingCapacity).toBe(1000);
    });

    it('re-checks event capacity after an event is created during the lookup', async () => {
      await patch({ seatingCapacity: 1000 }).expect(200);
      const gate = ctx.geocoder.pause();
      const slow = patch({ ...moved, seatingCapacity: 200 }).then((r) => r);
      await gate.started;
      await event(ctx, id, { name: 'Late Show', capacity: 400 });
      gate.release();
      const res = await slow;
      expect(res.status).toBe(409);
      expect(res.body.error.details.conflictingEvent.name).toBe('Late Show');
      expect((await row()).seatingCapacity).toBe(1000);
    });

    it('keeps capacity equal to the layout under 10 simultaneous edits and layout saves', async () => {
      const requests = Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0
          ? patch({ ...moved, street: `${900 + i} Phillips Ln`, seatingCapacity: 50 + i })
          : asAdmin(ctx)
              .put(`/locations/${id}/layout`)
              .send({ sections: [{ name: 'A', rows: 1, seatsPerRow: 10 + i }] }),
      );
      const results = await Promise.all(requests);
      expect(results.filter((r) => r.status >= 500)).toEqual([]);
      for (const r of results) expect([200, 400]).toContain(r.status);
      const layout = await asAdmin(ctx).get(`/locations/${id}/layout`).expect(200);
      expect((await row()).seatingCapacity).toBe(layout.body.totalSeats);
    });
  });

  describe('when the address service is unavailable (US2)', () => {
    it.each([
      ['without the flag', {}],
      ['without the flag, with a zone', { timeZone: 'America/Chicago' }],
    ])('refuses an address change %s with 503, venue unchanged', async (_l, extra) => {
      const before = await row();
      ctx.geocoder.next({ kind: 'unavailable' });
      const res = await patch({ ...moved, ...extra }).expect(503);
      expect(res.body.error.code).toBe('ADDRESS_SERVICE_UNAVAILABLE');
      expect(await row()).toEqual(before);
    });

    // Spec 024 FR-012 (research R5): with the flag, saved as sent and not verified.
    it('saves an address change with the flag as sent, not verified, in the zone sent', async () => {
      ctx.geocoder.next({ kind: 'unavailable' });
      const res = await patch({
        ...moved,
        street: ' 937  Phillips Ln ',
        zip: '40209-1234',
        acceptUnverifiedAddress: true,
        timeZone: 'America/Chicago',
      }).expect(200);
      expect(res.body).toMatchObject({
        street: '937 Phillips Ln',
        zip: '40209',
        address: '937 Phillips Ln, Louisville, KY 40209',
        addressVerified: false,
        timeZone: 'America/Chicago',
        timeZoneSource: 'ADMIN',
      });
    });

    it('with the flag and no zone in a two-zone state, still needs one, venue unchanged', async () => {
      const before = await row();
      ctx.geocoder.next({ kind: 'unavailable' });
      const res = await patch({ ...moved, acceptUnverifiedAddress: true }).expect(400);
      expect(res.body.error.code).toBe('TIME_ZONE_REQUIRED');
      expect(await row()).toEqual(before);
    });

    it('still saves a name-only edit, and venues still read (SC-006)', async () => {
      ctx.geocoder.always({ kind: 'unavailable' });
      const res = await patch({ name: 'Renamed' }).expect(200);
      expect(res.body.name).toBe('Renamed');
      await asAdmin(ctx).get('/locations').expect(200);
      await asAdmin(ctx).get(`/locations/${id}`).expect(200);
    });
  });
});
