import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 020 US1 scenario 6, FR-020 (research R15): `fromDate`/`toDate` match an event when it
 * starts on one of those days in its venue's local time. `from`/`to` (instants) are unchanged.
 */
describe('Event date filters by venue day (spec 020 FR-020)', () => {
  let ctx: TestContext;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    const venue = async (
      name: string,
      place: (typeof PLACES)[keyof typeof PLACES] | null,
      address: object,
    ) => {
      ctx.geocoder.reset();
      if (place) ctx.geocoder.placeAt(place);
      const res = await asAdmin(ctx)
        .post('/locations')
        .send({ name, seatingCapacity: 500, ...address })
        .expect(201);
      return res.body.id as string;
    };
    const east = await venue('Riverside', null, ADDRESS);
    const la = await venue('LA Hall', PLACES.losAngeles, {
      street: '111 S Grand Ave',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90012',
    });
    const honolulu = await venue('Ward Hall', PLACES.honolulu, {
      street: '777 Ward Ave',
      city: 'Honolulu',
      state: 'HI',
      zip: '96814',
    });
    const anchorage = await venue('Arctic Hall', PLACES.anchorage, {
      street: '600 W 7th Ave',
      city: 'Anchorage',
      state: 'AK',
      zip: '99501',
    });
    ctx.geocoder.reset();
    const event = async (name: string, locationId: string, startsAt: string, endsAt: string) => {
      const res = await asAdmin(ctx)
        .post('/events')
        .send({ name, locationId, startsAt, endsAt, totalTicketCapacity: 10, basePrice: '1.00' })
        .expect(201);
      ids[name] = res.body.id;
    };
    // 9:00 PM PDT on Oct 1 is 04:00Z on Oct 2 (already Oct 2 in Louisville).
    await event('LA Late', la, '2026-10-01T21:00:00-07:00', '2026-10-01T23:00:00-07:00');
    await event('East Evening', east, '2026-10-01T19:00:00-04:00', '2026-10-01T21:00:00-04:00');
    await event('East Early', east, '2026-10-02T00:30:00-04:00', '2026-10-02T01:30:00-04:00');
    // 11:00 PM HST on Oct 1 is 09:00Z on Oct 2.
    await event(
      'Honolulu Late',
      honolulu,
      '2026-10-01T23:00:00-10:00',
      '2026-10-01T23:30:00-10:00',
    );
    // 00:15 AKDT on Oct 2 is 08:15Z on Oct 2.
    await event(
      'Anchorage Early',
      anchorage,
      '2026-10-02T00:15:00-08:00',
      '2026-10-02T01:00:00-08:00',
    );
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const names = async (query: string) =>
    ((await asAdmin(ctx).get(`/events?${query}`).expect(200)).body as { name: string }[]).map(
      (e) => e.name,
    );

  it('Oct 1 to Oct 1 is every event starting on Oct 1 at its venue, soonest first', async () => {
    expect(await names('fromDate=2026-10-01&toDate=2026-10-01')).toEqual([
      'East Evening',
      'LA Late',
      'Honolulu Late',
    ]);
  });

  it('from Oct 2 gives the Oct 2 events, not the LA or Honolulu ones', async () => {
    expect(await names('fromDate=2026-10-02')).toEqual(['East Early', 'Anchorage Early']);
  });

  it('to Oct 1 alone is everything up to the end of Oct 1 at each venue', async () => {
    expect(await names('toDate=2026-10-01')).toEqual(['East Evening', 'LA Late', 'Honolulu Late']);
  });

  it('combines with the other filters', async () => {
    expect(await names('fromDate=2026-10-01&toDate=2026-10-02&q=late')).toEqual([
      'LA Late',
      'Honolulu Late',
    ]);
  });

  it.each([
    ['fromDate after toDate', 'fromDate=2026-10-02&toDate=2026-10-01', 'fromDate'],
    ['fromDate with from', 'fromDate=2026-10-01&from=2026-10-01T00:00:00Z', 'fromDate'],
    ['toDate with to', 'toDate=2026-10-01&to=2026-10-02T00:00:00Z', 'toDate'],
    ['a date-time as fromDate', 'fromDate=2026-10-01T00:00:00Z', 'fromDate'],
    ['not a date', 'toDate=2026-02-30', 'toDate'],
  ])('refuses %s with 400', async (_label, query, field) => {
    const res = await asAdmin(ctx).get(`/events?${query}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body.error)).toContain(field);
  });

  it('leaves from/to (instants) unchanged', async () => {
    expect(await names('from=2026-10-02T04:00:00Z&to=2026-10-02T04:15:00Z')).toEqual(['LA Late']);
  });
});
