import { doorsOpenRangeMessage } from '@queuepass/shared';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 025 US1 (FR-001, FR-004 to FR-008, FR-010; research R4, R6) (T006): every event has a
 * doors-open time, defaulted, kept at its gap to the start, checked in the venue's zone and
 * against the range. Every response is checked against the contract by `asAdmin`.
 */
describe('Doors-open time on events (spec 025 US1)', () => {
  let ctx: TestContext;
  let east: string;
  let central: string;

  const HOUR = 3_600_000;
  const minus = (iso: string, ms: number): string => new Date(Date.parse(iso) - ms).toISOString();

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.geocoder.reset();
    const mk = async (name: string, body: object) =>
      (
        await asAdmin(ctx)
          .post('/locations')
          .send({ name, seatingCapacity: 1000, ...body })
          .expect(201)
      ).body.id as string;
    east = await mk('Freedom Hall', { ...ADDRESS, timeZone: 'America/New_York' });
    central = await mk('Lakeside', {
      street: '233 S Wacker Dr',
      city: 'Chicago',
      state: 'IL',
      zip: '60606',
      timeZone: 'America/Chicago',
    });
  });

  // Nov 20, 2026, 7:00 PM to 10:00 PM EST: 2026-11-21T00:00Z to 03:00Z.
  const START = '2026-11-20T19:00:00-05:00';
  const END = '2026-11-20T22:00:00-05:00';
  const START_Z = '2026-11-21T00:00:00.000Z';

  const post = (body: object) =>
    asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Fall Concert',
        locationId: east,
        startsAt: START,
        endsAt: END,
        totalTicketCapacity: 10,
        basePrice: '1.00',
        ...body,
      });
  const patch = (id: string, body: object) => asAdmin(ctx).patch(`/events/${id}`).send(body);
  const stored = async (id: string) => {
    const e = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
    return {
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      doorsOpenAt: e.doorsOpenAt.toISOString(),
    };
  };

  describe('create', () => {
    it('without doorsOpenAt: doors 1 hour before the start, entry 2 hours before; get and list carry both', async () => {
      const res = await post({}).expect(201);
      expect(res.body.doorsOpenAt).toBe('2026-11-20T23:00:00.000Z');
      expect(res.body.entryOpensAt).toBe('2026-11-20T22:00:00.000Z');

      const one = await asAdmin(ctx).get(`/events/${res.body.id}`).expect(200);
      expect([one.body.doorsOpenAt, one.body.entryOpensAt]).toEqual([
        '2026-11-20T23:00:00.000Z',
        '2026-11-20T22:00:00.000Z',
      ]);
      const list = await asAdmin(ctx).get('/events').expect(200);
      expect(list.body[0]).toMatchObject({
        doorsOpenAt: '2026-11-20T23:00:00.000Z',
        entryOpensAt: '2026-11-20T22:00:00.000Z',
      });
    });

    it('doorsOpenAt null is treated as left out: the start minus 1 hour (review M5)', async () => {
      const res = await post({ doorsOpenAt: null }).expect(201);
      expect(res.body.doorsOpenAt).toBe('2026-11-20T23:00:00.000Z');
    });

    it('doors at 5:30 PM as sent; entry at 4:30 PM', async () => {
      const res = await post({ doorsOpenAt: '2026-11-20T17:30:00-05:00' }).expect(201);
      expect(res.body.doorsOpenAt).toBe('2026-11-20T22:30:00.000Z');
      expect(res.body.entryOpensAt).toBe('2026-11-20T21:30:00.000Z');
    });

    it.each([
      ['at the start', '2026-11-20T19:00:00-05:00', START_Z],
      ['exactly 6 hours before', '2026-11-20T13:00:00-05:00', '2026-11-20T18:00:00.000Z'],
    ])('doors %s: 201 as sent', async (_label, doors, expected) => {
      const res = await post({ doorsOpenAt: doors }).expect(201);
      expect(res.body.doorsOpenAt).toBe(expected);
    });

    it.each([
      ['6 hours 1 minute before', '2026-11-20T12:59:00-05:00', '2026-11-20T17:59:00.000Z'],
      ['1 minute after the start', '2026-11-20T19:01:00-05:00', '2026-11-21T00:01:00.000Z'],
    ])('doors %s: 400 DOORS_OPEN_OUT_OF_RANGE, nothing saved', async (_label, doors, doorsZ) => {
      const res = await post({ doorsOpenAt: doors }).expect(400);
      expect(res.body.error).toEqual({
        code: 'DOORS_OPEN_OUT_OF_RANGE',
        message: doorsOpenRangeMessage(START_Z, 'America/New_York'),
        details: {
          field: 'doorsOpenAt',
          doorsOpenAt: doorsZ,
          startsAt: START_Z,
          earliest: '2026-11-20T18:00:00.000Z',
          latest: START_Z,
          timeZone: 'America/New_York',
        },
      });
      expect(res.body.error.message).toBe(
        'Doors must open no more than 6 hours before the start and not after it: between ' +
          'Nov 20, 2026, 1:00 PM EST and 7:00 PM EST.',
      );
      expect(await ctx.prisma.event.count()).toBe(0);
    });

    it('doors in Z at an Eastern venue: 400 UTC_OFFSET_MISMATCH for doorsOpenAt', async () => {
      const res = await post({ doorsOpenAt: '2026-11-20T23:00:00Z' }).expect(400);
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(res.body.error.details).toMatchObject({
        field: 'doorsOpenAt',
        localTime: '2026-11-20T23:00',
        sentOffset: '+00:00',
        expectedOffsets: ['-05:00'],
      });
      expect(res.body.error.message).toMatch(/^doorsOpenAt is stated with offset \+00:00/);
      expect(await ctx.prisma.event.count()).toBe(0);
    });

    it('doors at 2:30 AM on 2027-03-14 Eastern: 400 LOCAL_TIME_SKIPPED for doorsOpenAt', async () => {
      const res = await post({
        startsAt: '2027-03-14T05:00:00-04:00',
        endsAt: '2027-03-14T07:00:00-04:00',
        doorsOpenAt: '2027-03-14T02:30:00-04:00',
      }).expect(400);
      expect(res.body.error.code).toBe('LOCAL_TIME_SKIPPED');
      expect(res.body.error.details).toMatchObject({
        field: 'doorsOpenAt',
        localTime: '2027-03-14T02:30',
        skippedFrom: '02:00',
        skippedTo: '03:00',
      });
    });

    it.each([
      ['-04:00', '2026-11-01T05:30:00.000Z'],
      ['-05:00', '2026-11-01T06:30:00.000Z'],
    ])('doors at 1:30 AM on 2026-11-01 Eastern with %s: that moment', async (offset, z) => {
      const res = await post({
        startsAt: '2026-11-01T03:00:00-05:00',
        endsAt: '2026-11-01T05:00:00-05:00',
        doorsOpenAt: `2026-11-01T01:30:00${offset}`,
      }).expect(201);
      expect(res.body.doorsOpenAt).toBe(z);
    });

    it('a bad endsAt offset and doors out of range: the endsAt refusal first', async () => {
      const res = await post({
        endsAt: '2026-11-20T22:00:00-07:00',
        doorsOpenAt: '2026-11-20T12:00:00-05:00',
      }).expect(400);
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(res.body.error.details.field).toBe('endsAt');
    });

    it('doors out of range and a capacity above the venue: DOORS_OPEN_OUT_OF_RANGE first', async () => {
      const res = await post({
        doorsOpenAt: '2026-11-20T12:00:00-05:00',
        totalTicketCapacity: 5000,
      }).expect(400);
      expect(res.body.error.code).toBe('DOORS_OPEN_OUT_OF_RANGE');
    });

    it('doors open while the venue’s previous event is on: allowed (FR-006)', async () => {
      await post({
        name: 'Matinee',
        startsAt: '2026-11-20T13:00:00-05:00',
        endsAt: '2026-11-20T16:00:00-05:00',
      }).expect(201);
      const res = await post({
        name: 'Evening',
        startsAt: '2026-11-20T17:00:00-05:00',
        endsAt: '2026-11-20T20:00:00-05:00',
        doorsOpenAt: '2026-11-20T15:00:00-05:00',
      }).expect(201);
      expect(res.body.doorsOpenAt).toBe('2026-11-20T20:00:00.000Z');
    });
  });

  describe('update', () => {
    it('only startsAt and endsAt 2 hours later: doors 2 hours later too (gap 60 minutes)', async () => {
      const { body: e } = await post({}).expect(201);
      const res = await patch(e.id, {
        startsAt: '2026-11-20T21:00:00-05:00',
        endsAt: '2026-11-21T00:00:00-05:00',
      }).expect(200);
      expect(res.body.doorsOpenAt).toBe('2026-11-21T01:00:00.000Z');
      expect(res.body.entryOpensAt).toBe('2026-11-21T00:00:00.000Z');
    });

    it('a 90-minute gap is kept when the start moves an hour later', async () => {
      const { body: e } = await post({ doorsOpenAt: '2026-11-20T17:30:00-05:00' }).expect(201);
      const res = await patch(e.id, {
        startsAt: '2026-11-20T20:00:00-05:00',
        endsAt: '2026-11-20T23:00:00-05:00',
      }).expect(200);
      expect(res.body.doorsOpenAt).toBe('2026-11-20T23:30:00.000Z');
    });

    it('a start moved 7 hours later keeps the gap (never pushed out of range)', async () => {
      // Doors 6 hours before; the stored doors would then be 13 hours before the new start.
      const { body: e } = await post({ doorsOpenAt: '2026-11-20T13:00:00-05:00' }).expect(201);
      const res = await patch(e.id, {
        startsAt: '2026-11-21T02:00:00-05:00',
        endsAt: '2026-11-21T05:00:00-05:00',
      }).expect(200);
      expect(res.body.doorsOpenAt).toBe(minus('2026-11-21T07:00:00.000Z', 6 * HOUR));
    });

    it('only doorsOpenAt: checked against the stored start', async () => {
      const { body: e } = await post({}).expect(201);
      const ok = await patch(e.id, { doorsOpenAt: '2026-11-20T14:00:00-05:00' }).expect(200);
      expect(ok.body.doorsOpenAt).toBe('2026-11-20T19:00:00.000Z');
      const refused = await patch(e.id, { doorsOpenAt: '2026-11-20T19:30:00-05:00' }).expect(400);
      expect(refused.body.error.code).toBe('DOORS_OPEN_OUT_OF_RANGE');
      expect((await stored(e.id)).doorsOpenAt).toBe('2026-11-20T19:00:00.000Z');
    });

    it('startsAt with doorsOpenAt out of range for the new start: 400, nothing changed', async () => {
      const { body: e } = await post({}).expect(201);
      const before = await stored(e.id);
      const res = await patch(e.id, {
        startsAt: '2026-11-20T21:00:00-05:00',
        endsAt: '2026-11-21T00:00:00-05:00',
        doorsOpenAt: '2026-11-20T14:00:00-05:00',
      }).expect(400);
      expect(res.body.error.code).toBe('DOORS_OPEN_OUT_OF_RANGE');
      expect(res.body.error.details.startsAt).toBe('2026-11-21T02:00:00.000Z');
      expect(await stored(e.id)).toEqual(before);
    });

    it('a name-only update leaves doors as they are', async () => {
      const { body: e } = await post({ doorsOpenAt: '2026-11-20T17:30:00-05:00' }).expect(201);
      const res = await patch(e.id, { name: 'Renamed' }).expect(200);
      expect(res.body.doorsOpenAt).toBe('2026-11-20T22:30:00.000Z');
    });

    it('a move to a venue in another zone with both times and no doors keeps the gap', async () => {
      const { body: e } = await post({ doorsOpenAt: '2026-11-20T17:30:00-05:00' }).expect(201);
      const res = await patch(e.id, {
        locationId: central,
        startsAt: '2026-11-20T19:00:00-06:00',
        endsAt: '2026-11-20T22:00:00-06:00',
      }).expect(200);
      // 7:00 PM CST is 01:00Z; 90 minutes before is 23:30Z, 5:30 PM CST.
      expect(res.body.doorsOpenAt).toBe('2026-11-20T23:30:00.000Z');
    });

    it('a cancelled event: 409 EVENT_CANCELLED for a doors update, as today', async () => {
      const { body: e } = await post({}).expect(201);
      await asAdmin(ctx).post(`/events/${e.id}/cancel`).expect(200);
      const res = await patch(e.id, { doorsOpenAt: '2026-11-20T17:30:00-05:00' }).expect(409);
      expect(res.body.error.code).toBe('EVENT_CANCELLED');
    });

    it('a cancelled event keeps its doors on record', async () => {
      const { body: e } = await post({ doorsOpenAt: '2026-11-20T17:30:00-05:00' }).expect(201);
      const res = await asAdmin(ctx).post(`/events/${e.id}/cancel`).expect(200);
      expect(res.body.event.doorsOpenAt).toBe('2026-11-20T22:30:00.000Z');
    });
  });
});
