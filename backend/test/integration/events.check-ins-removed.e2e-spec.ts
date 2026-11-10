import { formatEventDate, type UsTimeZone } from '@queuepass/shared';
import { asAdmin } from '../setup/authed-request';
import { PLACES } from '../setup/fake-geocoder';
import { atInstant, customer, event, HOLDER, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

const HOUR = 3_600_000;
const START = Date.parse('2026-10-01T23:00:00Z');
const END = Date.parse('2026-10-02T02:00:00Z');
const DOORS = START - HOUR;
const REMOVED_AT = '2026-11-10T03:00:00.000Z';

/**
 * Spec 032 US4 (FR-008, SC-006; research R6): once an event's check-in details are removed, its
 * start, end, and doors-open times no longer change; other fields still do. And every response
 * that carries an event says when its details were removed (contracts/README.md).
 */
describe('A removed event stays closed', () => {
  let ctx: TestContext;
  let id: string;
  let zone: UsTimeZone;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const hall = await venue(ctx, 'Retention Hall');
    zone = (await ctx.prisma.location.findUniqueOrThrow({ where: { id: hall } }))
      .timeZone as UsTimeZone;
    id = await event(ctx, hall, { name: 'Fall Concert', capacity: 10 });
    await (
      await customer(ctx, 1)
    )
      .post(`/events/${id}/orders`)
      .send({ holderName: HOLDER, quantity: 2 })
      .expect(201);
    await ctx.prisma.$executeRaw`
      UPDATE "Event" SET "startsAt" = ${new Date(START)}::timestamptz,
                         "endsAt" = ${new Date(END)}::timestamptz,
                         "doorsOpenAt" = ${new Date(DOORS)}::timestamptz
      WHERE "id" = ${id}::uuid`;
  });

  const markRemoved = () =>
    ctx.prisma.$executeRaw`
      UPDATE "Event" SET "checkInDetailsRemovedAt" = ${new Date(REMOVED_AT)}::timestamptz,
                         "keptCheckedInCount" = 2
      WHERE "id" = ${id}::uuid`;
  const at = (ms: number) => atInstant(ms, zone);
  const row = () => ctx.prisma.event.findUniqueOrThrow({ where: { id } });

  describe('on a removed event', () => {
    beforeEach(async () => {
      await markRemoved();
    });

    it.each([
      ['a later endsAt', () => ({ endsAt: at(END + HOUR) })],
      ['an earlier startsAt', () => ({ startsAt: at(START - HOUR) })],
      ['a different doorsOpenAt', () => ({ doorsOpenAt: at(DOORS - HOUR) })],
    ])('refuses %s with 409 CHECK_IN_DETAILS_REMOVED and changes nothing', async (_, body) => {
      const before = await row();
      const res = await asAdmin(ctx).patch(`/events/${id}`).send(body()).expect(409);

      expect(res.body.error.code).toBe('CHECK_IN_DETAILS_REMOVED');
      expect(res.body.error.details).toEqual({ removedAt: REMOVED_AT });
      expect(res.body.error.message).toBe(
        `The check-in details of Fall Concert were removed on ${formatEventDate(REMOVED_AT, zone)}, so its times can no longer change.`,
      );
      expect(await row()).toEqual(before);
    });

    it('names the date in the venue zone', async () => {
      const res = await asAdmin(ctx)
        .patch(`/events/${id}`)
        .send({ endsAt: at(END + HOUR) })
        .expect(409);
      // 03:00 UTC on Nov 10 is the evening of Nov 9 in every US zone.
      expect(res.body.error.message).toContain('removed on Nov 9, 2026,');
    });

    it("dates the removal in the event's current venue zone when the request also moves it (review round 1)", async () => {
      // 05:30 UTC on Nov 10: Nov 10 in Eastern time, still Nov 9 in Arizona.
      await ctx.prisma.$executeRaw`
        UPDATE "Event" SET "checkInDetailsRemovedAt" = ${new Date('2026-11-10T05:30:00Z')}::timestamptz
        WHERE "id" = ${id}::uuid`;
      ctx.geocoder.placeAt(PLACES.phoenix);
      const phoenix = (
        await asAdmin(ctx)
          .post('/locations')
          .send({
            name: 'Phoenix Hall',
            street: '201 E Jefferson St',
            city: 'Phoenix',
            state: 'AZ',
            zip: '85004',
            seatingCapacity: 500,
          })
          .expect(201)
      ).body;
      ctx.geocoder.reset();
      expect(phoenix.timeZone).toBe('America/Phoenix');
      expect(zone).toBe('America/New_York');

      const res = await asAdmin(ctx)
        .patch(`/events/${id}`)
        .send({
          locationId: phoenix.id,
          startsAt: atInstant(START, 'America/Phoenix'),
          endsAt: atInstant(END + HOUR, 'America/Phoenix'),
        })
        .expect(409);
      expect(res.body.error.code).toBe('CHECK_IN_DETAILS_REMOVED');
      expect(res.body.error.message).toContain('removed on Nov 10, 2026,');
    });

    it('accepts the stored instants with a new name', async () => {
      const res = await asAdmin(ctx)
        .patch(`/events/${id}`)
        .send({
          name: 'Fall Concert (past)',
          startsAt: at(START),
          endsAt: at(END),
          doorsOpenAt: at(DOORS),
        })
        .expect(200);
      expect(res.body.name).toBe('Fall Concert (past)');
      expect(res.body.checkInDetailsRemovedAt).toBe(REMOVED_AT);
      expect((await row()).endsAt).toEqual(new Date(END));
    });

    it('gives 400 first for an end before the start (research R6)', async () => {
      const res = await asAdmin(ctx)
        .patch(`/events/${id}`)
        .send({ startsAt: at(END), endsAt: at(START) })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('gives 409 CHECK_IN_DETAILS_REMOVED before a capacity below its sold tickets (research R6)', async () => {
      const res = await asAdmin(ctx)
        .patch(`/events/${id}`)
        .send({ endsAt: at(END + HOUR), totalTicketCapacity: 1 })
        .expect(409);
      expect(res.body.error.code).toBe('CHECK_IN_DETAILS_REMOVED');
    });
  });

  it('changes the times of an event not removed (as before)', async () => {
    const res = await asAdmin(ctx)
      .patch(`/events/${id}`)
      .send({ endsAt: at(END + HOUR) })
      .expect(200);
    expect(res.body.endsAt).toBe(new Date(END + HOUR).toISOString());
    expect(res.body.checkInDetailsRemovedAt).toBeNull();
  });

  describe('checkInDetailsRemovedAt in responses (contracts/README.md)', () => {
    const responses = async () => ({
      event: (await asAdmin(ctx).get(`/events/${id}`).expect(200)).body,
      order: (await (await customer(ctx, 1)).get('/me/orders').expect(200)).body[0].event,
      sales: (await asAdmin(ctx).get('/reports/sales').expect(200)).body.events[0],
    });

    it('is null before the removal and the instant after it', async () => {
      const before = await responses();
      expect(before.event.checkInDetailsRemovedAt).toBeNull();
      expect(before.order.checkInDetailsRemovedAt).toBeNull();
      expect(before.sales.checkInDetailsRemovedAt).toBeNull();

      await markRemoved();
      const after = await responses();
      expect(after.event.checkInDetailsRemovedAt).toBe(REMOVED_AT);
      expect(after.order.checkInDetailsRemovedAt).toBe(REMOVED_AT);
      expect(after.sales.checkInDetailsRemovedAt).toBe(REMOVED_AT);
    });

    it('never sends the kept count on the event, only in the report (research R7)', async () => {
      await markRemoved();
      const { event: e, sales } = await responses();
      expect(e).not.toHaveProperty('keptCheckedInCount');
      expect(sales.checkedIn).toBe(2);
    });
  });
});
