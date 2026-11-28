import { asAdmin } from '../setup/authed-request';
import { atInstant, seatedLayout, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { seasonWithSoldPass } from '../setup/season-fixtures';

/**
 * Spec 041 FR-007 (research R9, review S5): a layout an on-sale Season uses is locked as one with
 * tickets sold is (`039`): `409 LAYOUT_IN_USE` naming the Season, so a level can't be added
 * (unpriced) or removed (taking its pass price) under a Season customers can buy. A draft's
 * layout stays editable. A layout any Season uses can't be deleted.
 */
describe('Layouts used by a Season (041 FR-007)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  const lines = (levels: string[]) => ({
    levels: levels.map((name, i) => ({ name, color: ['blue', 'green', 'gold'][i] })),
    sections: [{ name: '101', rows: 3, seatsPerRow: 4, level: levels[0] }],
  });

  it('refuses every edit of a layout an on-sale Season uses, naming the Season', async () => {
    const f = await seasonWithSoldPass(ctx, { sold: false });
    const season = await ctx.prisma.season.findUniqueOrThrow({ where: { id: f.seasonId } });
    const rename = await asAdmin(ctx)
      .put(`/layouts/${f.layout!.id}`)
      .send({ name: 'Renamed plan' })
      .expect(409);
    expect(rename.body.error.code).toBe('LAYOUT_IN_USE');
    expect(rename.body.error.details).toMatchObject({
      seasonId: f.seasonId,
      seasonName: season.name,
    });
    expect(rename.body.error.message).toContain(season.name);

    const addLevel = await asAdmin(ctx)
      .put(`/layouts/${f.layout!.id}`)
      .send(lines(['Lower', 'Upper']))
      .expect(409);
    expect(addLevel.body.error.details.seasonId).toBe(f.seasonId);
  });

  it("keeps a draft Season's layout editable", async () => {
    const f = await seasonWithSoldPass(ctx, { status: 'DRAFT' });
    await asAdmin(ctx).put(`/layouts/${f.layout!.id}`).send({ name: 'Renamed plan' }).expect(200);
  });

  it('frees the layout once the Season is cancelled', async () => {
    const f = await seasonWithSoldPass(ctx, { sold: false });
    await asAdmin(ctx).post(`/seasons/${f.seasonId}/cancel`).expect(200);
    await asAdmin(ctx).put(`/layouts/${f.layout!.id}`).send({ name: 'Renamed plan' }).expect(200);
  });

  it('refuses deleting a layout any Season uses, a draft with no events included', async () => {
    const venueId = await venue(ctx, 'Plan Hall');
    const layout = await seatedLayout(ctx, venueId, [{ name: 'A', rows: 1, seatsPerRow: 2 }]);
    const draft = await asAdmin(ctx)
      .post('/seasons')
      .send({
        name: 'Plan only',
        locationId: venueId,
        layoutId: layout.id,
        salesEndAt: atInstant(Date.now() + 86_400_000),
        eventIds: [],
        prices: [],
      })
      .expect(201);
    const res = await asAdmin(ctx).delete(`/layouts/${layout.id}`).expect(409);
    expect(res.body.error.code).toBe('LAYOUT_IN_USE');
    expect(res.body.error.details).toMatchObject({
      seasonId: draft.body.id,
      seasonName: 'Plan only',
    });

    await asAdmin(ctx).delete(`/seasons/${draft.body.id}`).expect(204);
    await asAdmin(ctx).delete(`/layouts/${layout.id}`).expect(204);
  });
});
