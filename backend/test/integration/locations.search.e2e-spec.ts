import { asAdmin } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/** Spec 004 US3 (FR-007, FR-009) — filtering GET /locations by name or address. */
describe('Venue search', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    for (const [name, address] of [
      ['Rupp Arena', '430 W Vine St, Lexington, KY'],
      ['Yum Center', '1 Arena Plaza, Louisville, KY'],
      ['Freedom Hall', '937 Phillips Ln, Louisville, KY'],
    ]) {
      await asAdmin(ctx)
        .post('/locations')
        .send({ name, address, seatingCapacity: 100 })
        .expect(201);
    }
  });

  const names = (body: { name: string }[]) => body.map((v) => v.name);

  it('matches the address, such as a city, ignoring case, in name order', async () => {
    const res = await asAdmin(ctx).get('/locations?q=LOUISVILLE').expect(200);
    expect(names(res.body)).toEqual(['Freedom Hall', 'Yum Center']);
  });

  it('matches the name', async () => {
    const res = await asAdmin(ctx).get('/locations?q=%20arena%20').expect(200);
    // "Rupp Arena" by name, "Yum Center" by its address "1 Arena Plaza".
    expect(names(res.body)).toEqual(['Rupp Arena', 'Yum Center']);
  });

  it('returns everything for a blank q and nothing for no match', async () => {
    expect((await asAdmin(ctx).get('/locations?q=').expect(200)).body).toHaveLength(3);
    expect((await asAdmin(ctx).get('/locations?q=zzz').expect(200)).body).toEqual([]);
  });

  it('refuses q longer than 200 characters', async () => {
    await asAdmin(ctx)
      .get(`/locations?q=${'x'.repeat(201)}`)
      .expect(400);
  });
});
