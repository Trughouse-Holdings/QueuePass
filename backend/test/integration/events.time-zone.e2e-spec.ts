import { randomUUID } from 'node:crypto';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 020 US2 scenario 7, US3 scenarios 6 to 8 (FR-018, FR-019, FR-022, SC-007; research R9):
 * an event time must state the venue's local time with the venue's offset. Every response is
 * checked against the contract by `asAdmin`.
 */
describe('Event times in the venue zone (spec 020 FR-018)', () => {
  let ctx: TestContext;
  let east: string;
  let east2: string;
  let phoenix: string;

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
    east = await mk('Riverside', ADDRESS);
    east2 = await mk('Second Hall', { ...ADDRESS, street: '432 W Vine St' });
    ctx.geocoder.placeAt(PLACES.phoenix);
    phoenix = await mk('Phoenix Hall', {
      street: '201 E Jefferson St',
      city: 'Phoenix',
      state: 'AZ',
      zip: '85004',
    });
    ctx.geocoder.reset();
  });

  const post = (body: object) =>
    asAdmin(ctx)
      .post('/events')
      .send({ name: 'Show', totalTicketCapacity: 10, basePrice: '1.00', ...body });
  const at = (locationId: string, startsAt: string, endsAt: string) =>
    post({ locationId, startsAt, endsAt });

  describe('the offset must be the venue’s', () => {
    it('accepts 19:00-04:00 at an Eastern venue in October, stored at 23:00Z', async () => {
      const res = await at(east, '2026-10-01T19:00:00-04:00', '2026-10-01T22:00:00-04:00').expect(
        201,
      );
      expect(res.body.startsAt).toBe('2026-10-01T23:00:00.000Z');
      expect(res.body.endsAt).toBe('2026-10-02T02:00:00.000Z');
    });

    it('refuses 19:00-07:00 at an Eastern venue: 400 UTC_OFFSET_MISMATCH, nothing saved', async () => {
      const res = await at(east, '2026-10-01T19:00:00-07:00', '2026-10-01T23:00:00-04:00').expect(
        400,
      );
      expect(res.body.error).toEqual({
        code: 'UTC_OFFSET_MISMATCH',
        message:
          'startsAt is stated with offset -07:00, but Riverside is in Eastern Time, which is ' +
          "-04:00 at that time. Send the venue's local time with its offset.",
        details: {
          field: 'startsAt',
          localTime: '2026-10-01T19:00',
          timeZone: 'America/New_York',
          sentOffset: '-07:00',
          expectedOffsets: ['-04:00'],
        },
      });
      expect(await ctx.prisma.event.count()).toBe(0);
    });

    it('refuses a time in UTC (Z): 400 UTC_OFFSET_MISMATCH', async () => {
      const res = await at(east, '2026-10-01T23:00:00Z', '2026-10-02T02:00:00Z').expect(400);
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(res.body.error.details).toMatchObject({
        field: 'startsAt',
        localTime: '2026-10-01T23:00',
        sentOffset: '+00:00',
        expectedOffsets: ['-04:00'],
      });
    });

    it('checks endsAt the same way', async () => {
      const res = await at(east, '2026-10-01T19:00:00-04:00', '2026-10-01T19:00:00-07:00').expect(
        400,
      );
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(res.body.error.details).toMatchObject({ field: 'endsAt', sentOffset: '-07:00' });
      expect(res.body.error.message).toMatch(/^endsAt is stated with offset -07:00/);
    });

    it('uses EST in December', async () => {
      await at(east, '2026-12-05T20:00:00-05:00', '2026-12-05T23:00:00-05:00').expect(201);
      const res = await at(east, '2026-12-12T20:00:00-04:00', '2026-12-12T23:00:00-05:00').expect(
        400,
      );
      expect(res.body.error.details.expectedOffsets).toEqual(['-05:00']);
    });
  });

  describe('a skipped local time (US3 scenario 6)', () => {
    it.each(['-05:00', '-04:00'])(
      'refuses 2027-03-14T02:30%s: 400 LOCAL_TIME_SKIPPED, nothing saved',
      async (offset) => {
        const res = await at(
          east,
          `2027-03-14T02:30:00${offset}`,
          '2027-03-14T05:00:00-04:00',
        ).expect(400);
        expect(res.body.error).toEqual({
          code: 'LOCAL_TIME_SKIPPED',
          message:
            "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to " +
            '3:00 AM. Choose another time.',
          details: {
            field: 'startsAt',
            localTime: '2027-03-14T02:30',
            timeZone: 'America/New_York',
            skippedFrom: '02:00',
            skippedTo: '03:00',
          },
        });
        expect(await ctx.prisma.event.count()).toBe(0);
      },
    );

    it('refuses a skipped end the same way', async () => {
      const res = await at(east, '2027-03-14T00:30:00-05:00', '2027-03-14T02:15:00-05:00').expect(
        400,
      );
      expect(res.body.error.code).toBe('LOCAL_TIME_SKIPPED');
      expect(res.body.error.details.field).toBe('endsAt');
    });

    it('accepts 01:59-05:00 and 03:00-04:00, the two sides of the gap', async () => {
      await at(east, '2027-03-13T22:59:00-05:00', '2027-03-14T01:59:00-05:00').expect(201);
      await at(east2, '2027-03-14T03:00:00-04:00', '2027-03-14T05:00:00-04:00').expect(201);
    });

    it('accepts an event from 01:00 EST to 03:00 EDT on the spring night: one hour long', async () => {
      const res = await at(east, '2027-03-14T01:00:00-05:00', '2027-03-14T03:00:00-04:00').expect(
        201,
      );
      expect(Date.parse(res.body.endsAt) - Date.parse(res.body.startsAt)).toBe(3_600_000);
    });
  });

  describe('a repeated local time (US3 scenario 7)', () => {
    it('accepts 01:30-04:00 as the first time and 01:30-05:00 as the second', async () => {
      const first = await at(east, '2027-11-07T01:30:00-04:00', '2027-11-07T03:30:00-05:00').expect(
        201,
      );
      expect(first.body.startsAt).toBe('2027-11-07T05:30:00.000Z');
      const second = await at(
        east2,
        '2027-11-07T01:30:00-05:00',
        '2027-11-07T03:30:00-05:00',
      ).expect(201);
      expect(second.body.startsAt).toBe('2027-11-07T06:30:00.000Z');
    });

    it('refuses 01:30-06:00, listing both offsets', async () => {
      const res = await at(east, '2027-11-07T01:30:00-06:00', '2027-11-07T03:30:00-05:00').expect(
        400,
      );
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(res.body.error.details.expectedOffsets).toEqual(['-04:00', '-05:00']);
      expect(res.body.error.message).toContain('which is -04:00 or -05:00 at that time');
    });
  });

  describe('Phoenix (no daylight saving, US3 scenario 5)', () => {
    it('accepts 2027-03-14T02:30-07:00 and refuses -06:00', async () => {
      await at(phoenix, '2027-03-14T02:30:00-07:00', '2027-03-14T04:00:00-07:00').expect(201);
      const res = await at(
        phoenix,
        '2027-03-15T02:30:00-06:00',
        '2027-03-15T04:00:00-07:00',
      ).expect(400);
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(res.body.error.details).toMatchObject({
        timeZone: 'America/Phoenix',
        expectedOffsets: ['-07:00'],
      });
      expect(res.body.error.message).toContain('Arizona Time (no daylight saving)');
    });
  });

  describe('a time without an offset (R9, review round 1 S6)', () => {
    const MESSAGE = (field: string) =>
      `${field} must include a UTC offset, for example 2026-10-01T19:00:00-04:00`;

    it.each([
      ['startsAt', '2026-10-01T19:00:00'],
      ['startsAt', '2026-10-01'],
      ['endsAt', '2026-10-01T22:00:00'],
      ['endsAt', '2026-10-01'],
    ])('refuses %s %s on create with 400 VALIDATION_FAILED, before the venue', async (field, v) => {
      const body = {
        locationId: randomUUID(), // no such venue: the field check comes first
        startsAt: '2026-10-01T19:00:00-04:00',
        endsAt: '2026-10-01T22:00:00-04:00',
        [field]: v,
      };
      const res = await post(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(res.body.error)).toContain(MESSAGE(field));
    });

    it.each([
      ['startsAt', '2026-10-01T19:00:00'],
      ['endsAt', '2026-10-01'],
    ])('refuses %s %s on update', async (field, v) => {
      const { body: e } = await at(
        east,
        '2026-10-01T19:00:00-04:00',
        '2026-10-01T22:00:00-04:00',
      ).expect(201);
      const res = await asAdmin(ctx)
        .patch(`/events/${e.id}`)
        .send({ [field]: v })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(res.body.error)).toContain(MESSAGE(field));
    });
  });

  describe('refusal order', () => {
    it('a missing venue is 404 before any zone check', async () => {
      await at(randomUUID(), '2026-10-01T19:00:00-07:00', '2026-10-01T22:00:00-07:00').expect(404);
    });

    it('endsAt <= startsAt is VALIDATION_FAILED first', async () => {
      const res = await at(east, '2026-10-01T19:00:00-07:00', '2026-10-01T18:00:00-07:00').expect(
        400,
      );
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('a zone refusal comes before CAPACITY_EXCEEDED and SCHEDULING_CONFLICT', async () => {
      await at(east, '2026-10-01T19:00:00-04:00', '2026-10-01T22:00:00-04:00').expect(201);
      const res = await post({
        locationId: east,
        startsAt: '2026-10-01T19:00:00-07:00',
        endsAt: '2026-10-01T23:00:00-04:00',
        totalTicketCapacity: 999_999,
      }).expect(400);
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(await ctx.prisma.event.count()).toBe(1);
    });
  });

  describe('updateEvent (FR-019)', () => {
    const create = async () =>
      (await at(east, '2026-10-01T19:00:00-04:00', '2026-10-01T22:00:00-04:00').expect(201)).body;
    const patch = (id: string, body: object) => asAdmin(ctx).patch(`/events/${id}`).send(body);

    it('checks only the time sent', async () => {
      const e = await create();
      await patch(e.id, { endsAt: '2026-10-01T23:00:00-04:00' }).expect(200);
      const res = await patch(e.id, { endsAt: '2026-10-01T23:00:00-07:00' }).expect(400);
      expect(res.body.error.details.field).toBe('endsAt');
    });

    it('moving to a venue in another zone without both times is refused', async () => {
      const e = await create();
      for (const body of [
        { locationId: phoenix },
        { locationId: phoenix, startsAt: '2026-10-01T18:00:00-07:00' },
      ]) {
        const res = await patch(e.id, body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(res.body.error)).toContain(
          'Send startsAt and endsAt when moving an event to a venue in another time zone, so ' +
            'its local times are clear.',
        );
      }
      const stored = await ctx.prisma.event.findUniqueOrThrow({ where: { id: e.id } });
      expect(stored.locationId).toBe(east);
    });

    it("moving with both times in the destination's offset is 200", async () => {
      const e = await create();
      const res = await patch(e.id, {
        locationId: phoenix,
        startsAt: '2026-10-01T19:00:00-07:00',
        endsAt: '2026-10-01T22:00:00-07:00',
      }).expect(200);
      expect(res.body.startsAt).toBe('2026-10-02T02:00:00.000Z');
      expect(res.body.location.timeZone).toBe('America/Phoenix');
    });

    it("moving with times in the old venue's offset is refused", async () => {
      const e = await create();
      const res = await patch(e.id, {
        locationId: phoenix,
        startsAt: '2026-10-01T19:00:00-04:00',
        endsAt: '2026-10-01T22:00:00-04:00',
      }).expect(400);
      expect(res.body.error.code).toBe('UTC_OFFSET_MISMATCH');
      expect(res.body.error.details.timeZone).toBe('America/Phoenix');
    });

    it('moving within the same zone without times keeps the instants', async () => {
      const e = await create();
      const res = await patch(e.id, { locationId: east2 }).expect(200);
      expect([res.body.startsAt, res.body.endsAt]).toEqual([e.startsAt, e.endsAt]);
    });
  });

  describe('the scheduling conflict message (FR-022, R9 m12)', () => {
    it("names the conflicting event's times in the venue's zone", async () => {
      await post({
        name: 'X',
        locationId: east,
        startsAt: '2026-10-01T19:00:00-04:00',
        endsAt: '2026-10-01T22:00:00-04:00',
      }).expect(201);
      const res = await at(east, '2026-10-01T20:00:00-04:00', '2026-10-01T23:00:00-04:00').expect(
        409,
      );
      expect(res.body.error.message).toBe(
        "This venue is already committed from Oct 1, 2026, 7:00 PM EDT to 10:00 PM EDT by 'X'. " +
          'Events at the same venue must be at least 60 minutes apart.',
      );
      expect(res.body.error.details.conflictingEvent).toMatchObject({
        name: 'X',
        startsAt: '2026-10-01T23:00:00.000Z',
        endsAt: '2026-10-02T02:00:00.000Z',
      });
    });

    it('uses MST at Phoenix', async () => {
      await post({
        name: 'X',
        locationId: phoenix,
        startsAt: '2026-10-01T19:00:00-07:00',
        endsAt: '2026-10-01T22:00:00-07:00',
      }).expect(201);
      const res = await at(
        phoenix,
        '2026-10-01T20:00:00-07:00',
        '2026-10-01T23:00:00-07:00',
      ).expect(409);
      expect(res.body.error.message).toContain('from Oct 1, 2026, 7:00 PM MST to 10:00 PM MST');
    });

    it('gives the end its own date when it is on the next day', async () => {
      await post({
        name: 'Late',
        locationId: east,
        startsAt: '2026-10-01T22:00:00-04:00',
        endsAt: '2026-10-02T01:00:00-04:00',
      }).expect(201);
      const res = await at(east, '2026-10-01T23:00:00-04:00', '2026-10-02T00:30:00-04:00').expect(
        409,
      );
      expect(res.body.error.message).toBe(
        'This venue is already committed from Oct 1, 2026, 10:00 PM EDT to Oct 2, 2026, 1:00 AM ' +
          "EDT by 'Late'. Events at the same venue must be at least 60 minutes apart.",
      );
    });
  });
});
