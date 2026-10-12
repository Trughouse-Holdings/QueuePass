import { formatAddress } from '@queuepass/shared';
import { asAdmin } from '../setup/authed-request';
import { windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 013 FR-010, FR-016, FR-020; data-model.md. Storage first: the CHECKs keep the four parts
 * all-or-none, well-formed, equal to `address`, and present on every verified venue, whichever
 * path writes them. Venues from before this feature keep only their one-line address.
 */
describe('Venue address storage (spec 013)', () => {
  let ctx: TestContext;
  const parts = { street: '430 W VINE ST', city: 'LEXINGTON', state: 'KY', zip: '40507' };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  const insert = (data: Record<string, unknown>) =>
    ctx.prisma.location.create({
      data: { name: 'Hall', address: 'x', seatingCapacity: 10, ...data },
    });

  it('accepts a venue with only the one-line address, not verified by default', async () => {
    const row = await insert({ address: '1 Demo Plaza, Louisville, KY' });
    expect(row.street).toBeNull();
    expect(row.city).toBeNull();
    expect(row.state).toBeNull();
    expect(row.zip).toBeNull();
    expect(row.addressVerified).toBe(false);
  });

  it('refuses some parts set and others NULL', async () => {
    await expect(
      insert({ ...parts, zip: null, address: '430 W VINE ST, LEXINGTON, KY ' }),
    ).rejects.toThrow(/location_address_parts_all_or_none/);
  });

  it.each([
    ['a lower-case state', { state: 'ky' }],
    ['a four-digit ZIP', { zip: '4050' }],
  ])('refuses %s', async (_label, change) => {
    const p = { ...parts, ...change };
    await expect(insert({ ...p, address: formatAddress(p) })).rejects.toThrow(
      /location_address_parts_format/,
    );
  });

  it('refuses parts with an address that is not built from them', async () => {
    await expect(
      insert({ ...parts, address: '430 W Vine St, Lexington, KY 40507' }),
    ).rejects.toThrow(/location_address_matches_parts/);
  });

  it.each([true, false])('accepts parts with the matching address, verified %s', async (v) => {
    const row = await insert({ ...parts, address: formatAddress(parts), addressVerified: v });
    expect(row.address).toBe('430 W VINE ST, LEXINGTON, KY 40507');
    expect(row.addressVerified).toBe(v);
  });

  it('refuses a verified venue without parts', async () => {
    await expect(insert({ address: '1 Demo Plaza', addressVerified: true })).rejects.toThrow(
      /location_verified_has_parts/,
    );
  });

  describe('a venue from before this feature (US4, FR-016)', () => {
    let id: string;
    const OLD = '1 Demo Plaza, Louisville, KY';
    const moved = { street: '937 Phillips Ln', city: 'Louisville', state: 'KY', zip: '40209' };

    beforeEach(async () => {
      ctx.geocoder.reset();
      id = (await insert({ name: 'Demo Arena', address: OLD, seatingCapacity: 2000 })).id;
    });

    const legacyShape = {
      address: OLD,
      street: null,
      city: null,
      state: null,
      zip: null,
      addressVerified: false,
    };

    it('reads back unchanged, with null parts and not verified', async () => {
      const list = await asAdmin(ctx).get('/locations').expect(200);
      expect(list.body[0]).toMatchObject(legacyShape);
      const one = await asAdmin(ctx).get(`/locations/${id}`).expect(200);
      expect(one.body).toMatchObject(legacyShape);
    });

    it('is found by a word in its address', async () => {
      const res = await asAdmin(ctx).get('/locations?q=demo%20plaza').expect(200);
      expect(res.body.map((v: { id: string }) => v.id)).toEqual([id]);
    });

    it('takes an event, which embeds it', async () => {
      const ev = await asAdmin(ctx)
        .post('/events')
        .send({
          name: 'Old Show',
          locationId: id,
          ...windowAt(400),
          totalTicketCapacity: 100,
          basePrice: '10.00',
        })
        .expect(201);
      const got = await asAdmin(ctx).get(`/events/${ev.body.id}`).expect(200);
      expect(got.body.location).toMatchObject(legacyShape);
    });

    it('saves a name-only edit without asking the service, still without parts', async () => {
      const res = await asAdmin(ctx)
        .patch(`/locations/${id}`)
        .send({ name: 'Demo Arena II' })
        .expect(200);
      expect(ctx.geocoder.calls).toHaveLength(0);
      expect(res.body).toMatchObject({ ...legacyShape, name: 'Demo Arena II' });
    });

    it('checks the four fields when filled in, and a match replaces the address, verified', async () => {
      const res = await asAdmin(ctx).patch(`/locations/${id}`).send(moved).expect(200);
      expect(ctx.geocoder.calls).toHaveLength(1);
      expect(res.body).toMatchObject({
        address: '937 PHILLIPS LN, LOUISVILLE, KY 40209',
        street: '937 PHILLIPS LN',
        city: 'LOUISVILLE',
        state: 'KY',
        zip: '40209',
        addressVerified: true,
      });
    });

    it('refuses an unmatched address and leaves the row unchanged', async () => {
      const before = await ctx.prisma.location.findUniqueOrThrow({ where: { id } });
      ctx.geocoder.next({ kind: 'none' });
      const res = await asAdmin(ctx).patch(`/locations/${id}`).send(moved).expect(400);
      expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
      expect(await ctx.prisma.location.findUniqueOrThrow({ where: { id } })).toEqual(before);
    });

    it('saves an unmatched address anyway as typed, not verified', async () => {
      ctx.geocoder.next({ kind: 'none' });
      const res = await asAdmin(ctx)
        .patch(`/locations/${id}`)
        .send({ ...moved, acceptUnverifiedAddress: true })
        .expect(200);
      expect(res.body).toMatchObject({
        address: '937 Phillips Ln, Louisville, KY 40209',
        street: '937 Phillips Ln',
        addressVerified: false,
      });
    });
  });
});
