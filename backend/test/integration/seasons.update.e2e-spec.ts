import { as, asAdmin } from '../setup/authed-request';
import { HOLDER, atInstant, rowLabel, seatedEvent, venue, windowAt } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { seasonWithSoldPass, type SeasonFixture } from '../setup/season-fixtures';
import { CUSTOMER, subFor, tokenFor } from '../setup/tokens';

/**
 * Spec 041 US2 (FR-005, FR-008, FR-010, FR-011; research R2, R3): updating and deleting Seasons,
 * with the shared fixture's sold pass where one is needed.
 */
describe('Seasons: update and delete (041 US2)', () => {
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

  /** The stored Season as the form would send it back, with `over` applied. */
  async function inputOf(seasonId: string, over: Record<string, unknown> = {}) {
    const s = await ctx.prisma.season.findUniqueOrThrow({
      where: { id: seasonId },
      include: { events: true, prices: true, location: true },
    });
    const zone = s.location.timeZone as 'America/New_York';
    return {
      name: s.name,
      sport: s.sport,
      team: s.team,
      locationId: s.locationId,
      layoutId: s.layoutId,
      salesEndAt: atInstant(s.salesEndAt, zone),
      singleSalesOpenAt: s.singleSalesOpenAt ? atInstant(s.singleSalesOpenAt, zone) : null,
      maxPassesPerCustomer: s.maxPassesPerCustomer,
      eventIds: s.events.map((e) => e.eventId),
      prices: s.prices.map((p) =>
        p.levelId
          ? { levelId: p.levelId, price: p.price.toFixed(2) }
          : { tierName: p.tierName, price: p.price.toFixed(2) },
      ),
      ...over,
    };
  }

  const put = (id: string, body: object) => asAdmin(ctx).put(`/seasons/${id}`).send(body);
  const fieldsOf = (body: { error: { details?: { fields?: string[] } } }) =>
    (body.error.details?.fields ?? []).map((f) => f.split(' ')[0]);

  describe('updateSeason', () => {
    it('replaces the fields, events and prices of a Season with no passes', async () => {
      const f = await seasonWithSoldPass(ctx, { sold: false });
      const res = await put(
        f.seasonId,
        await inputOf(f.seasonId, {
          name: 'Renamed',
          sport: null,
          team: null,
          maxPassesPerCustomer: 4,
          eventIds: [f.eventIds[1], f.eventIds[2]],
          prices: [{ levelId: f.layout!.levels.Lower, price: '75.50' }],
        }),
      ).expect(200);
      expect(res.body).toMatchObject({
        name: 'Renamed',
        sport: null,
        team: null,
        maxPassesPerCustomer: 4,
        status: 'ON_SALE',
      });
      expect(res.body.events.map((e: { id: string }) => e.id)).toEqual([
        f.eventIds[1],
        f.eventIds[2],
      ]);
      expect(res.body.prices[0].price).toBe('75.50');
      // The removed event is free for another Season.
      expect(await ctx.prisma.seasonEvent.count({ where: { eventId: f.eventIds[0] } })).toBe(0);
    });

    it('refuses changing the events, venue or layout once a pass is sold (SEASON_HAS_PASSES)', async () => {
      const f = await seasonWithSoldPass(ctx);
      const events = await put(
        f.seasonId,
        await inputOf(f.seasonId, { eventIds: [f.eventIds[0], f.eventIds[1]] }),
      ).expect(409);
      expect(events.body.error.code).toBe('SEASON_HAS_PASSES');
      expect(events.body.error.details).toMatchObject({ field: 'eventIds', passesSold: 1 });

      const elsewhere = await venue(ctx, 'Elsewhere');
      const moved = await put(f.seasonId, await inputOf(f.seasonId, { locationId: elsewhere }));
      expect(moved.status).toBe(409);
      expect(moved.body.error.details.field).toBe('locationId');

      const ga = await put(f.seasonId, await inputOf(f.seasonId, { layoutId: null })).expect(409);
      expect(ga.body.error.details.field).toBe('layoutId');
    });

    it('saves a price change with a pass sold; the sold orders keep their prices', async () => {
      const f = await seasonWithSoldPass(ctx);
      const res = await put(
        f.seasonId,
        await inputOf(f.seasonId, {
          prices: [{ levelId: f.layout!.levels.Lower, price: '160.00' }],
        }),
      ).expect(200);
      expect(res.body.prices[0].price).toBe('160.00');
      expect(res.body.passesSold).toBe(1);
      expect(res.body.passRevenue).toBe('100.00');
      const orders = await ctx.prisma.order.findMany({
        where: { seasonPassId: f.pass!.id },
        include: { event: true },
        orderBy: { event: { startsAt: 'asc' } },
      });
      expect(orders.map((o) => o.totalPrice.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
      const pass = await ctx.prisma.seasonPass.findUniqueOrThrow({ where: { id: f.pass!.id } });
      expect(pass.totalPrice.toFixed(2)).toBe('100.00');
    });

    it('keeps a Season on sale sellable: every level still priced', async () => {
      const f = await seasonWithSoldPass(ctx, { sold: false });
      const res = await put(f.seasonId, await inputOf(f.seasonId, { prices: [] })).expect(400);
      expect(fieldsOf(res.body)).toEqual([`prices.${f.layout!.levels.Lower}`]);
    });

    it('saves a Season on sale after its sales end has passed, and with one event left', async () => {
      const f = await seasonWithSoldPass(ctx, { sold: false });
      await asAdmin(ctx).post(`/events/${f.eventIds[1]}/cancel`).expect(200);
      await asAdmin(ctx).post(`/events/${f.eventIds[2]}/cancel`).expect(200);
      await ctx.prisma.season.update({
        where: { id: f.seasonId },
        data: { salesEndAt: new Date(Date.now() - 60_000) },
      });
      const res = await put(f.seasonId, await inputOf(f.seasonId, { name: 'Still here' })).expect(
        200,
      );
      expect(res.body.name).toBe('Still here');
      expect(res.body.salesOpen).toBe(false);
      expect(res.body.events.map((e: { status: string }) => e.status)).toEqual([
        'SCHEDULED',
        'CANCELLED',
        'CANCELLED',
      ]);
    });

    it('refuses any save of a cancelled Season (409 SEASON_CANCELLED)', async () => {
      const f = await seasonWithSoldPass(ctx);
      await asAdmin(ctx).post(`/seasons/${f.seasonId}/cancel`).expect(200);
      const res = await put(f.seasonId, await inputOf(f.seasonId, { name: 'Nope' })).expect(409);
      expect(res.body.error.code).toBe('SEASON_CANCELLED');
    });

    it('applies the save rules: a field at fault and an event in another Season', async () => {
      const a = await seasonWithSoldPass(ctx, { sold: false });
      expect(
        fieldsOf(
          (await put(a.seasonId, await inputOf(a.seasonId, { name: ' ' })).expect(400)).body,
        ),
      ).toEqual(['name']);
      const b = await seasonWithSoldPass(ctx, { status: 'DRAFT' });
      const res = await put(
        b.seasonId,
        await inputOf(b.seasonId, { eventIds: [...b.eventIds, a.eventIds[0]] }),
      );
      // a.eventIds[0] is at another venue, so it is refused as such before EVENT_IN_SEASON.
      expect(res.status).toBe(400);
      expect(fieldsOf(res.body)).toEqual(['eventIds.3']);
    });

    it('is for admins only, and 404s for a Season that does not exist', async () => {
      const f = await seasonWithSoldPass(ctx, { sold: false });
      await as(ctx, customerToken)
        .put(`/seasons/${f.seasonId}`)
        .send(await inputOf(f.seasonId))
        .expect(403);
      await put('00000000-0000-4000-8000-000000000000', await inputOf(f.seasonId)).expect(404);
    });
  });

  describe('the pass figures', () => {
    it('go to admins; a customer reads them as null', async () => {
      const f = await seasonWithSoldPass(ctx);
      const admin = await asAdmin(ctx).get(`/seasons/${f.seasonId}`).expect(200);
      expect(admin.body).toMatchObject({ passesSold: 1, passRevenue: '100.00' });
      const customer = await as(ctx, customerToken).get(`/seasons/${f.seasonId}`).expect(200);
      expect(customer.body).toMatchObject({ passesSold: null, passRevenue: null });
    });
  });

  describe('deleteSeason (FR-008)', () => {
    it('deletes a draft and frees its events', async () => {
      const f = await seasonWithSoldPass(ctx, { status: 'DRAFT' });
      await asAdmin(ctx).delete(`/seasons/${f.seasonId}`).expect(204);
      expect(await ctx.prisma.season.count({ where: { id: f.seasonId } })).toBe(0);
      expect(await ctx.prisma.seasonEvent.count({ where: { eventId: { in: f.eventIds } } })).toBe(
        0,
      );
    });

    it('refuses a Season on sale or cancelled (409 SEASON_NOT_DRAFT)', async () => {
      const f = await seasonWithSoldPass(ctx, { sold: false });
      const res = await asAdmin(ctx).delete(`/seasons/${f.seasonId}`).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'SEASON_NOT_DRAFT',
        details: { status: 'ON_SALE' },
      });
      await asAdmin(ctx).post(`/seasons/${f.seasonId}/cancel`).expect(200);
      const cancelled = await asAdmin(ctx).delete(`/seasons/${f.seasonId}`).expect(409);
      expect(cancelled.body.error.details.status).toBe('CANCELLED');
    });

    it('is for admins only', async () => {
      const f = await seasonWithSoldPass(ctx, { status: 'DRAFT' });
      await as(ctx, customerToken).delete(`/seasons/${f.seasonId}`).expect(403);
    });
  });

  /**
   * FR-005, R2, SC-002: `042`'s pass confirm takes the Season `FOR SHARE`, reads the Season's
   * events and writes the pass; an update removing an event takes it `FOR UPDATE` and counts the
   * passes. One waits for the other, so a pass never sees an event list that changes under it.
   */
  describe('an update racing a pass sale (FR-005)', () => {
    let f: SeasonFixture;
    beforeEach(async () => {
      f = await seasonWithSoldPass(ctx, { sold: false });
    });

    /** A pass written as 042 will: Season FOR SHARE, the event list read, then the row. */
    const sellPass = async (pauseSeconds: number) =>
      ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Season" WHERE "id" = ${f.seasonId}::uuid FOR SHARE`;
        const seen = await tx.seasonEvent.count({ where: { seasonId: f.seasonId } });
        await tx.$executeRaw`SELECT pg_sleep(${pauseSeconds})`;
        await tx.seasonPass.create({
          data: {
            seasonId: f.seasonId,
            customerSub: subFor('customer2'),
            customerUsername: 'customer2',
            holderName: HOLDER,
            seatId: f.layout!.seat('101', 2, 2),
            seatSection: '101',
            seatRowLabel: rowLabel(2),
            seatLabel: '2',
            levelId: f.layout!.levels.Lower,
            totalPrice: '100.00',
          },
        });
        return seen;
      });

    it('refuses the update when the pass holds the Season first', async () => {
      const body = await inputOf(f.seasonId, { eventIds: [f.eventIds[0], f.eventIds[1]] });
      const sale = sellPass(0.5);
      await new Promise((r) => setTimeout(r, 150));
      const update = await put(f.seasonId, body);
      expect(await sale).toBe(3);
      expect(update.status).toBe(409);
      expect(update.body.error.code).toBe('SEASON_HAS_PASSES');
      expect(await ctx.prisma.seasonEvent.count({ where: { seasonId: f.seasonId } })).toBe(3);
    });

    it('never lets both land on different event lists when they start together', async () => {
      const body = await inputOf(f.seasonId, { eventIds: [f.eventIds[0], f.eventIds[1]] });
      const [update, seen] = await Promise.all([put(f.seasonId, body), sellPass(0.2)]);
      const after = await ctx.prisma.seasonEvent.count({ where: { seasonId: f.seasonId } });
      if (update.status === 200) {
        // The update committed first; the pass then saw the new list.
        expect(seen).toBe(2);
        expect(after).toBe(2);
      } else {
        expect(update.body.error.code).toBe('SEASON_HAS_PASSES');
        expect(seen).toBe(3);
        expect(after).toBe(3);
      }
    });
  });

  it('refuses moving a draft to an event on another layout, naming it', async () => {
    const f = await seasonWithSoldPass(ctx, { status: 'DRAFT' });
    const other = await seatedEvent(ctx, f.venueId, {
      sections: [{ name: 'X', rows: 1, seatsPerRow: 2 }],
      ...windowAt(1500, 19),
    });
    const res = await put(
      f.seasonId,
      await inputOf(f.seasonId, { eventIds: [...f.eventIds, other.eventId] }),
    ).expect(400);
    expect(fieldsOf(res.body)).toEqual(['eventIds.3']);
  });
});

/**
 * Research R2 (review S8, review of the implementation): an update reads the Season's venue before
 * its transaction; when another update moves the Season meanwhile, the first sees the moved row
 * under the Season lock, rolls back, and tries once more with the venue as it now is.
 */
describe('Seasons: an update racing a venue move (R2)', () => {
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

  it('retries the update that read the old venue, and both succeed', async () => {
    const a = await venue(ctx, 'Venue A');
    const b = await venue(ctx, 'Venue B');
    const body = (locationId: string, name: string) => ({
      name,
      locationId,
      layoutId: null,
      salesEndAt: atInstant(Date.now() + 86_400_000),
      eventIds: [],
      prices: [],
    });
    const draft = await asAdmin(ctx).post('/seasons').send(body(a, 'Draft')).expect(201);
    const id = draft.body.id as string;

    // Hold the Season row so both updates read venue A and then queue for its lock.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = ctx.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Season" WHERE "id" = ${id}::uuid FOR UPDATE`;
        await held;
      },
      { timeout: 20_000 },
    );
    await new Promise((r) => setTimeout(r, 100));
    const move = asAdmin(ctx).put(`/seasons/${id}`).send(body(b, 'Moved'));
    const moving = move.then((res) => res);
    await new Promise((r) => setTimeout(r, 300));
    const stale = asAdmin(ctx)
      .put(`/seasons/${id}`)
      .send(body(a, 'Renamed at A'))
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await holder;

    const [moved, renamed] = await Promise.all([moving, stale]);
    expect(moved.status).toBe(200);
    expect(renamed.status).toBe(200);
    const row = await ctx.prisma.season.findUniqueOrThrow({ where: { id } });
    // The stale update ran last, on its retry, and its whole Season stands.
    expect(row).toMatchObject({ name: 'Renamed at A', locationId: a });
  });
});
