import { as, asAdmin } from '../setup/authed-request';
import { atInstant, event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { seasonWithSoldPass } from '../setup/season-fixtures';
import { CUSTOMER, tokenFor } from '../setup/tokens';

/**
 * Spec 041 FR-013, FR-019 (research R5): every event read says which Season the event is in
 * (`season`, cancelled Seasons included) and, while that Season is on sale and its presale runs
 * by the database's clock, when single tickets go on sale (`singleSalesOpenAt`); `null`
 * otherwise. Checked against contract 2.2.0 by the request helpers.
 */
describe('Events read their Season (041 FR-013, FR-019)', () => {
  let ctx: TestContext;
  let customerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    customerToken = await tokenFor(CUSTOMER);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  const HOUR = 3_600_000;
  const presale = () => new Date(Date.now() + 24 * HOUR);

  const readBoth = async (eventId: string, token?: string) => {
    const client = token ? as(ctx, token) : asAdmin(ctx);
    const one = (await client.get(`/events/${eventId}`).expect(200)).body;
    const list = (await client.get('/events').expect(200)).body.find(
      (e: { id: string }) => e.id === eventId,
    );
    return { one, list };
  };

  it('gives the Season and its single-ticket time, to admins and customers alike', async () => {
    const at = presale();
    const f = await seasonWithSoldPass(ctx, { singleSalesOpenAt: at });
    const season = await ctx.prisma.season.findUniqueOrThrow({ where: { id: f.seasonId } });
    for (const token of [undefined, customerToken]) {
      const { one, list } = await readBoth(f.eventIds[1], token);
      for (const e of [one, list]) {
        expect(e.season).toEqual({ id: f.seasonId, name: season.name });
        expect(new Date(e.singleSalesOpenAt).getTime()).toBe(at.getTime());
      }
    }
  });

  it('gives null for an event in no Season', async () => {
    const v = await venue(ctx);
    const id = await event(ctx, v);
    const { one, list } = await readBoth(id);
    expect(one).toMatchObject({ season: null, singleSalesOpenAt: null });
    expect(list).toMatchObject({ season: null, singleSalesOpenAt: null });
  });

  it('gives no single-ticket time for a draft, a Season with no presale, or a presale past', async () => {
    const draft = await seasonWithSoldPass(ctx, { status: 'DRAFT', singleSalesOpenAt: presale() });
    expect((await readBoth(draft.eventIds[0])).one).toMatchObject({ singleSalesOpenAt: null });
    expect((await readBoth(draft.eventIds[0])).one.season.id).toBe(draft.seasonId);

    const none = await seasonWithSoldPass(ctx, { sold: false });
    expect((await readBoth(none.eventIds[0])).one.singleSalesOpenAt).toBeNull();

    const past = await seasonWithSoldPass(ctx, {
      sold: false,
      singleSalesOpenAt: new Date(Date.now() - HOUR),
    });
    expect((await readBoth(past.eventIds[0])).one.singleSalesOpenAt).toBeNull();
  });

  it('names a cancelled Season but gives no single-ticket time', async () => {
    const f = await seasonWithSoldPass(ctx, { singleSalesOpenAt: presale() });
    await asAdmin(ctx).post(`/seasons/${f.seasonId}/cancel`).expect(200);
    const { one } = await readBoth(f.eventIds[0]);
    expect(one.season.id).toBe(f.seasonId);
    expect(one.singleSalesOpenAt).toBeNull();
  });

  it('shows a cleared single-ticket time as null at once', async () => {
    const f = await seasonWithSoldPass(ctx, { sold: false, singleSalesOpenAt: presale() });
    const s = await ctx.prisma.season.findUniqueOrThrow({
      where: { id: f.seasonId },
      include: { events: true, prices: true },
    });
    await asAdmin(ctx)
      .put(`/seasons/${f.seasonId}`)
      .send({
        name: s.name,
        sport: s.sport,
        team: s.team,
        locationId: s.locationId,
        layoutId: s.layoutId,
        salesEndAt: atInstant(s.salesEndAt),
        singleSalesOpenAt: null,
        maxPassesPerCustomer: null,
        eventIds: s.events.map((e) => e.eventId),
        prices: s.prices.map((p) => ({ levelId: p.levelId, price: p.price.toFixed(2) })),
      })
      .expect(200);
    for (const id of f.eventIds) {
      expect((await readBoth(id)).one.singleSalesOpenAt).toBeNull();
    }
  });
});
