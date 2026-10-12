import { formatAddress } from '@queuepass/shared';
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
});
