import { localDate } from '@queuepass/shared';
import { as, asAdmin } from '../setup/authed-request';
import { atInstant, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { ADMIN, AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/**
 * Spec 030 FR-001 to FR-007, SC-001 to SC-003 (research R1 to R3, R11): the event list leaves out
 * events whose end the Backend's clock has reached, unless the caller sends `includePast=true`.
 * Events are made relative to the real time; the boundary uses the injectable clock.
 */
describe('The event list leaves past events out (spec 030)', () => {
  let ctx: TestContext;
  const ZONE = 'America/New_York';
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  // A whole minute, so every time sent is one the Backend stores exactly.
  const base = Math.floor(Date.now() / MINUTE) * MINUTE;
  const ids: Record<string, string> = {};
  const times: Record<string, { startsAt: number; endsAt: number }> = {};
  let hall: string;
  let club: string;
  let arena: string;

  const create = async (name: string, locationId: string, startsAt: number, endsAt: number) => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({
        name,
        locationId,
        startsAt: atInstant(startsAt, ZONE),
        endsAt: atInstant(endsAt, ZONE),
        totalTicketCapacity: 10,
        basePrice: '1.00',
      })
      .expect(201);
    ids[name] = res.body.id;
    times[name] = { startsAt, endsAt };
    return res.body.id as string;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    // Two venues, so the 60-minute rule never meets these events; a third for the boundary.
    hall = await venue(ctx, 'Past Hall');
    club = await venue(ctx, 'Past Club');
    arena = await venue(ctx, 'Past Arena');
    await create('Ended Show', hall, base - 3 * HOUR, base - MINUTE);
    const gone = await create('Cancelled Gala', club, base - 4 * HOUR, base - 2 * HOUR);
    await asAdmin(ctx).post(`/events/${gone}/cancel`).expect(200);
    await create('Now Playing', club, base - 30 * MINUTE, base + 2 * HOUR);
    await create('Coming Soon', hall, base + 7 * 24 * HOUR, base + 7 * 24 * HOUR + 3 * HOUR);
  });
  afterEach(() => ctx.clock.useRealTime());
  afterAll(async () => {
    await ctx.app.close();
  });

  const names = async (query = '', token?: string) => {
    const client = token ? as(ctx, token) : asAdmin(ctx);
    const res = await client.get(`/events${query ? `?${query}` : ''}`).expect(200);
    return (res.body as { name: string }[]).map((e) => e.name);
  };

  it('lists only events that have not ended, soonest first, by default', async () => {
    expect(await names()).toEqual(['Now Playing', 'Coming Soon']);
  });

  it('treats includePast=false as the default', async () => {
    expect(await names('includePast=false')).toEqual(['Now Playing', 'Coming Soon']);
  });

  it('lists every event, soonest start first, with includePast=true', async () => {
    expect(await names('includePast=true')).toEqual([
      'Cancelled Gala',
      'Ended Show',
      'Now Playing',
      'Coming Soon',
    ]);
  });

  describe('combines with the other filters (FR-005)', () => {
    it('q: nothing without includePast, the ended event with it', async () => {
      expect(await names('q=Ended%20Show')).toEqual([]);
      expect(await names('q=Ended%20Show&includePast=true')).toEqual(['Ended Show']);
      expect(await names('q=Ended%20Show&includePast=false')).toEqual([]);
    });

    it('from/to: nothing without includePast, the ended event with it', async () => {
      const start = times['Ended Show'].startsAt;
      const range = `from=${new Date(start - 30 * MINUTE).toISOString()}&to=${new Date(
        start + 30 * MINUTE,
      ).toISOString()}`;
      expect(await names(range)).toEqual([]);
      expect(await names(`${range}&includePast=true`)).toEqual(['Ended Show']);
    });

    it('locationId: the ended event absent without includePast, present with it', async () => {
      expect(await names(`locationId=${hall}`)).not.toContain('Ended Show');
      expect(await names(`locationId=${hall}&includePast=true`)).toContain('Ended Show');
    });

    it("fromDate/toDate: the ended event's local day, absent without it, present with it", async () => {
      const day = localDate(new Date(times['Ended Show'].startsAt), ZONE);
      const days = `fromDate=${day}&toDate=${day}`;
      expect(await names(days)).not.toContain('Ended Show');
      expect(await names(`${days}&includePast=true`)).toContain('Ended Show');
    });
  });

  it.each([['TRUE'], ['1'], ['yes'], ['']])(
    'refuses includePast=%s with 400 VALIDATION_FAILED naming it',
    async (value) => {
      const res = await asAdmin(ctx).get(`/events?includePast=${value}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(res.body.error)).toContain('includePast');
    },
  );

  it.each([
    ['an admin', ADMIN],
    ['a customer', CUSTOMER],
    ['a gate agent', AGENT],
  ])('lets %s ask for past events (FR-004)', async (_label, who) => {
    const listed = await names('includePast=true', await tokenFor(who));
    expect(listed).toEqual(expect.arrayContaining(['Ended Show', 'Cancelled Gala']));
  });

  it('still returns an ended event by its id (FR-007)', async () => {
    const res = await asAdmin(ctx).get(`/events/${ids['Ended Show']}`).expect(200);
    expect(res.body.name).toBe('Ended Show');
  });

  it('leaves an event out at its end exactly, and lists it one millisecond before (SC-003)', async () => {
    const end = base + 30 * 24 * HOUR;
    await create('Boundary Show', arena, end - 3 * HOUR, end);
    ctx.clock.set(end);
    expect(await names('q=Boundary')).toEqual([]);
    expect(await names('q=Boundary&includePast=true')).toEqual(['Boundary Show']);
    ctx.clock.set(end - 1);
    expect(await names('q=Boundary')).toEqual(['Boundary Show']);
  });
});
