import { as, asAdmin } from '../setup/authed-request';
import {
  atInstant,
  endEventAt,
  event,
  seatedEvent,
  seatedLayout,
  tier,
  venue,
  windowAt,
  type InsertedLayout,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { CUSTOMER, tokenFor } from '../setup/tokens';

/**
 * Spec 041 US1 (FR-001 to FR-006, FR-009, FR-010; research R2–R4, R16): creating, reading and
 * publishing Seasons through the API. Every response is checked against contract 2.2.0 by the
 * request helpers.
 */
describe('Seasons: create, read, publish (041 US1)', () => {
  let ctx: TestContext;
  let customerToken: string;
  let venueId: string;
  let layout: InsertedLayout;
  /** Three seated games on `layout`, by start. */
  let games: string[];
  let firstStart: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    customerToken = await tokenFor(CUSTOMER);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Hoops Arena');
    layout = await seatedLayout(
      ctx,
      venueId,
      [
        { name: '101', rows: 2, seatsPerRow: 3, level: 'Lower' },
        { name: '201', rows: 2, seatsPerRow: 3, level: 'Upper' },
      ],
      ['Lower', 'Upper'],
    );
    games = [];
    for (const [i, d] of [10, 17, 24].entries()) {
      const w = windowAt(d, 19);
      if (i === 0) firstStart = w.startsAt;
      const g = await seatedEvent(ctx, venueId, {
        layout,
        levels: [
          { name: 'Lower', price: '40.00' },
          { name: 'Upper', price: '20.00' },
        ],
        name: `Game ${i + 1}`,
        ...w,
      });
      games.push(g.eventId);
    }
  });

  /** A seated Season ready to publish: two games, every level priced. */
  const input = (over: Record<string, unknown> = {}) => ({
    name: 'Spring Hoops',
    sport: 'BASKETBALL',
    team: 'Test Team',
    locationId: venueId,
    layoutId: layout.id,
    salesEndAt: atInstant(new Date(firstStart).getTime() - 3_600_000),
    singleSalesOpenAt: null,
    maxPassesPerCustomer: null,
    eventIds: [games[0], games[1]],
    prices: [
      { levelId: layout.levels.Upper, price: '60.00' },
      { levelId: layout.levels.Lower, price: '100.00' },
    ],
    ...over,
  });

  const create = (over: Record<string, unknown> = {}) =>
    asAdmin(ctx).post('/seasons').send(input(over));

  /** The field paths a 400 names. */
  const fieldsOf = (body: { error: { details?: { fields?: string[] } } }) =>
    (body.error.details?.fields ?? []).map((f) => f.split(' ')[0]);

  describe('createSeason', () => {
    it('saves a draft with its events and prices, in order (201)', async () => {
      const res = await create({ eventIds: [games[1], games[0]] }).expect(201);
      expect(res.body).toMatchObject({
        name: 'Spring Hoops',
        sport: 'BASKETBALL',
        team: 'Test Team',
        venueName: 'Hoops Arena',
        timeZone: 'America/New_York',
        layoutId: layout.id,
        status: 'DRAFT',
        salesOpen: false,
        publishedAt: null,
        cancelledAt: null,
        passesSold: 0,
        passRevenue: '0.00',
      });
      expect(res.body.events.map((e: { id: string }) => e.id)).toEqual([games[0], games[1]]);
      expect(res.body.prices.map((p: { levelName: string; price: string }) => p)).toEqual([
        { levelId: layout.levels.Lower, levelName: 'Lower', tierName: null, price: '100.00' },
        { levelId: layout.levels.Upper, levelName: 'Upper', tierName: null, price: '60.00' },
      ]);
      expect(await ctx.prisma.seasonEvent.count({ where: { seasonId: res.body.id } })).toBe(2);
    });

    it('lets a draft be saved without events or prices', async () => {
      const res = await create({ eventIds: [], prices: [] }).expect(201);
      expect(res.body.events).toEqual([]);
      expect(res.body.prices).toEqual([]);
    });

    it('is for admins only (403 for a customer)', async () => {
      const res = await as(ctx, customerToken).post('/seasons').send(input()).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await ctx.prisma.season.count()).toBe(0);
    });

    it('names each missing or malformed field (400 VALIDATION_FAILED)', async () => {
      const res = await asAdmin(ctx)
        .post('/seasons')
        .send({ eventIds: [], prices: [] })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res.body)).toEqual(
        expect.arrayContaining(['name', 'locationId', 'layoutId', 'salesEndAt']),
      );
    });

    it('refuses a name blank after trimming, and a sport without a team (both or neither)', async () => {
      expect(fieldsOf((await create({ name: '   ' }).expect(400)).body)).toEqual(['name']);
      expect(fieldsOf((await create({ team: null }).expect(400)).body)).toEqual(['team']);
      expect(fieldsOf((await create({ sport: null }).expect(400)).body)).toEqual(['sport']);
      await create({ sport: null, team: null }).expect(201);
    });

    it('refuses passes per customer outside 1 to 10', async () => {
      expect(fieldsOf((await create({ maxPassesPerCustomer: 11 }).expect(400)).body)).toEqual([
        'maxPassesPerCustomer',
      ]);
      expect(fieldsOf((await create({ maxPassesPerCustomer: 0 }).expect(400)).body)).toEqual([
        'maxPassesPerCustomer',
      ]);
      await create({ maxPassesPerCustomer: 10 }).expect(201);
    });

    it('refuses a sales end after the first event starts, and single sales after the sales end', async () => {
      const late = atInstant(new Date(firstStart).getTime() + 60_000);
      const res = await create({ salesEndAt: late }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['salesEndAt']);
      expect(res.body.error.details.fields[0]).toContain('Game 1');
      await create({ salesEndAt: firstStart }).expect(201);

      const salesEnd = new Date(firstStart).getTime() - 3_600_000;
      const presale = await create({ singleSalesOpenAt: atInstant(salesEnd + 60_000) }).expect(400);
      expect(fieldsOf(presale.body)).toEqual(['singleSalesOpenAt']);
    });

    it('checks the times in the venue zone (UTC_OFFSET_MISMATCH naming the field)', async () => {
      const res = await create({ salesEndAt: new Date(firstStart).toISOString() }).expect(400);
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(res.body.error.details.field).toBe('salesEndAt');
    });

    it('names each event at fault: another venue, general admission, cancelled, started', async () => {
      const elsewhere = await venue(ctx, 'Elsewhere');
      const away = await event(ctx, elsewhere, { name: 'Away game', ...windowAt(12, 19) });
      const ga = await event(ctx, venueId, { name: 'Walk-in', capacity: 10, ...windowAt(13, 12) });
      await asAdmin(ctx).post(`/events/${games[2]}/cancel`).expect(200);
      const res = await create({ eventIds: [games[0], away, ga, games[2]] }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['eventIds.1', 'eventIds.2', 'eventIds.3']);

      const started = await seatedEvent(ctx, venueId, {
        layout,
        levels: [
          { name: 'Lower', price: '40.00' },
          { name: 'Upper', price: '20.00' },
        ],
        name: 'Tip-off',
        ...windowAt(30, 19),
      });
      await endEventAt(ctx, started.eventId, new Date(Date.now() + 2 * 3_600_000));
      const startedRes = await create({
        eventIds: [started.eventId],
        salesEndAt: atInstant(Date.now() - 4 * 3_600_000),
      }).expect(400);
      expect(fieldsOf(startedRes.body)).toEqual(['eventIds.0']);
    });

    it('refuses an event on another layout, and a layout of another venue', async () => {
      const other = await seatedLayout(ctx, venueId, [{ name: 'A', rows: 1, seatsPerRow: 2 }]);
      const onOther = await seatedEvent(ctx, venueId, { layout: other, ...windowAt(40, 19) });
      expect(
        fieldsOf((await create({ eventIds: [games[0], onOther.eventId] }).expect(400)).body),
      ).toEqual(['eventIds.1']);

      const elsewhere = await venue(ctx, 'Elsewhere');
      const theirs = await seatedLayout(ctx, elsewhere, [{ name: 'A', rows: 1, seatsPerRow: 2 }]);
      const res = await create({ layoutId: theirs.id, eventIds: [], prices: [] }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['layoutId']);
    });

    it('refuses a price for a level not of the layout, or a level twice, by index', async () => {
      const other = await seatedLayout(ctx, venueId, [{ name: 'A', rows: 1, seatsPerRow: 2 }]);
      const res = await create({
        prices: [
          { levelId: layout.levels.Lower, price: '100.00' },
          { levelId: other.levels.Standard, price: '1.00' },
          { levelId: layout.levels.Lower, price: '2.00' },
          { tierName: 'General', price: '3.00' },
        ],
      }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['prices.1', 'prices.2', 'prices.3']);
    });

    it('refuses an event already in another Season (409 EVENT_IN_SEASON, its index)', async () => {
      const first = await create({ name: 'First' }).expect(201);
      const res = await create({ name: 'Second', eventIds: [games[2], games[1]] }).expect(409);
      expect(res.body.error.code).toBe('EVENT_IN_SEASON');
      expect(res.body.error.details).toMatchObject({
        field: 'eventIds.1',
        seasonId: first.body.id,
        seasonName: 'First',
      });
      expect(await ctx.prisma.season.count()).toBe(1);
    });

    it('404s for a venue that does not exist', async () => {
      await create({
        locationId: '00000000-0000-4000-8000-000000000000',
        eventIds: [],
        prices: [],
      }).expect(404);
    });
  });

  describe('two creates naming one event at the same moment (FR-004, SC-002)', () => {
    it('saves exactly one; the other is 409 EVENT_IN_SEASON', async () => {
      const results = await Promise.all([
        create({ name: 'Left', eventIds: [games[0], games[1]] }),
        create({ name: 'Right', eventIds: [games[2], games[0]] }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const refused = results.find((r) => r.status === 409)!;
      expect(refused.body.error.code).toBe('EVENT_IN_SEASON');
      expect(await ctx.prisma.season.count()).toBe(1);
      expect(await ctx.prisma.seasonEvent.count({ where: { eventId: games[0] } })).toBe(1);
    });
  });

  describe('listSeasons and getSeason', () => {
    it('give admins drafts, and customers only Seasons on sale with no figures', async () => {
      const draft = await create({ name: 'Draft one', eventIds: [games[2]] }).expect(201);
      const ready = await create({ name: 'Ready one' }).expect(201);
      await asAdmin(ctx).post(`/seasons/${ready.body.id}/publish`).expect(200);

      const admin = await asAdmin(ctx).get('/seasons').expect(200);
      expect(admin.body.map((s: { name: string }) => s.name)).toEqual(['Ready one', 'Draft one']);

      const customer = await as(ctx, customerToken).get('/seasons').expect(200);
      expect(customer.body.map((s: { name: string }) => s.name)).toEqual(['Ready one']);
      expect(customer.body[0]).toMatchObject({ passesSold: null, passRevenue: null });

      await as(ctx, customerToken).get(`/seasons/${draft.body.id}`).expect(404);
      const one = await as(ctx, customerToken).get(`/seasons/${ready.body.id}`).expect(200);
      expect(one.body).toMatchObject({ status: 'ON_SALE', salesOpen: true, passesSold: null });
      const adminOne = await asAdmin(ctx).get(`/seasons/${draft.body.id}`).expect(200);
      expect(adminOne.body.status).toBe('DRAFT');
    });

    it('lists Seasons with no events last, by name', async () => {
      await create({ name: 'Zeta', eventIds: [], prices: [] }).expect(201);
      await create({ name: 'Alpha', eventIds: [], prices: [] }).expect(201);
      await create({ name: 'Late', eventIds: [games[2]] }).expect(201);
      const res = await asAdmin(ctx).get('/seasons').expect(200);
      expect(res.body.map((s: { name: string }) => s.name)).toEqual(['Late', 'Alpha', 'Zeta']);
    });

    it('404s for a Season that does not exist, 400 for an id that is not one', async () => {
      await asAdmin(ctx).get('/seasons/00000000-0000-4000-8000-000000000000').expect(404);
      await asAdmin(ctx).get('/seasons/not-a-uuid').expect(400);
    });
  });

  describe('publishSeason (FR-010)', () => {
    const publish = (id: string) => asAdmin(ctx).post(`/seasons/${id}/publish`);

    it('puts a ready draft on sale, setting publishedAt', async () => {
      const draft = await create().expect(201);
      const res = await publish(draft.body.id).expect(200);
      expect(res.body.status).toBe('ON_SALE');
      expect(res.body.publishedAt).not.toBeNull();
      expect(res.body.salesOpen).toBe(true);
    });

    it('refuses fewer than 2 events, naming eventIds', async () => {
      const draft = await create({ eventIds: [games[0]] }).expect(201);
      const res = await publish(draft.body.id).expect(400);
      expect(fieldsOf(res.body)).toEqual(['eventIds']);
      const row = await ctx.prisma.season.findUniqueOrThrow({ where: { id: draft.body.id } });
      expect(row.status).toBe('DRAFT');
    });

    it('refuses a level with no price, naming prices.<levelId>', async () => {
      const draft = await create({
        prices: [{ levelId: layout.levels.Lower, price: '100.00' }],
      }).expect(201);
      const res = await publish(draft.body.id).expect(400);
      expect(fieldsOf(res.body)).toEqual([`prices.${layout.levels.Upper}`]);
      expect(res.body.error.details.fields[0]).toContain('Upper');
    });

    it('refuses a sales end that has passed', async () => {
      const draft = await create({ salesEndAt: atInstant(Date.now() - 60_000) }).expect(201);
      const res = await publish(draft.body.id).expect(400);
      expect(fieldsOf(res.body)).toEqual(['salesEndAt']);
    });

    it('refuses a Season already on sale (409 SEASON_NOT_DRAFT)', async () => {
      const draft = await create().expect(201);
      await publish(draft.body.id).expect(200);
      const res = await publish(draft.body.id).expect(409);
      expect(res.body.error.code).toBe('SEASON_NOT_DRAFT');
      expect(res.body.error.details.status).toBe('ON_SALE');
    });

    it('is for admins only', async () => {
      const draft = await create().expect(201);
      await as(ctx, customerToken).post(`/seasons/${draft.body.id}/publish`).expect(403);
    });

    describe('general admission', () => {
      let shows: string[];
      beforeEach(async () => {
        shows = [];
        for (const d of [11, 18]) {
          const id = await event(ctx, venueId, {
            name: `Show ${d}`,
            capacity: 10,
            ...windowAt(d, 12),
          });
          await tier(ctx, id, 'General', '30.00', 5);
          shows.push(id);
        }
        await tier(ctx, shows[0], 'VIP', '90.00', 5);
      });
      const gaInput = (over: Record<string, unknown> = {}) => ({
        layoutId: null,
        eventIds: shows,
        prices: [{ tierName: 'general', price: '50.00' }],
        salesEndAt: atInstant(Date.now() + 86_400_000),
        ...over,
      });

      it('publishes with one name priced that every event sells, ignoring case', async () => {
        const draft = await create(gaInput()).expect(201);
        expect(draft.body.prices).toEqual([
          { levelId: null, levelName: null, tierName: 'general', price: '50.00' },
        ]);
        await publish(draft.body.id).expect(200);
      });

      it('refuses a name an event lacks at save, naming the entry and the event', async () => {
        const res = await create(gaInput({ prices: [{ tierName: 'VIP', price: '1.00' }] })).expect(
          400,
        );
        expect(fieldsOf(res.body)).toEqual(['prices.0']);
        expect(res.body.error.details.fields[0]).toContain('Show 18');
      });

      it('refuses to publish with no name priced, or a priced name an event lost', async () => {
        const none = await create(gaInput({ prices: [] })).expect(201);
        expect(fieldsOf((await publish(none.body.id).expect(400)).body)).toEqual(['prices']);
        await ctx.prisma.season.delete({ where: { id: none.body.id } });

        const priced = await create(gaInput({ name: 'Priced', eventIds: [] })).expect(201);
        await ctx.prisma.seasonEvent.createMany({
          data: shows.map((eventId) => ({ eventId, seasonId: priced.body.id })),
        });
        // Below the Backend's own rules, which refuse renaming a priced name (R9).
        await ctx.prisma.ticketTier.updateMany({
          where: { eventId: shows[1], name: 'General' },
          data: { name: 'Standing' },
        });
        const res = await publish(priced.body.id).expect(400);
        expect(fieldsOf(res.body)).toEqual(['prices.0']);
        expect(res.body.error.details.fields[0]).toContain('Show 18');
      });
    });
  });
});
