import { randomUUID } from 'node:crypto';
import type { ArgumentsHost } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../../src/common/filters/prisma-exception.filter';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS, orderWithTickets } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 020 US5 (FR-009 to FR-013, SC-005; research R8): a zone change keeps every event's local
 * times, is refused when any event has an order, when a local time is skipped or repeated in the
 * new zone, or when the moved events break the 60-minute rule; all or nothing.
 */
describe('Changing a venue time zone (spec 020 US5)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.geocoder.reset();
  });

  const PHOENIX_ADDRESS = {
    street: '201 E Jefferson St',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85004',
  };

  async function venue(where: 'east' | 'phoenix' = 'east'): Promise<string> {
    if (where === 'phoenix') ctx.geocoder.placeAt(PLACES.phoenix);
    const address = where === 'east' ? ADDRESS : PHOENIX_ADDRESS;
    const res = await asAdmin(ctx)
      .post('/locations')
      .send({
        name: where === 'east' ? 'Riverside' : 'Phoenix Hall',
        ...address,
        seatingCapacity: 500,
      })
      .expect(201);
    ctx.geocoder.reset();
    return res.body.id;
  }

  async function event(locationId: string, name: string, startsAt: string, endsAt: string) {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({ name, locationId, startsAt, endsAt, totalTicketCapacity: 10, basePrice: '1.00' })
      .expect(201);
    return res.body as { id: string; startsAt: string; endsAt: string };
  }

  const patch = (id: string, body: object) => asAdmin(ctx).patch(`/locations/${id}`).send(body);
  const stored = async (id: string) => {
    const e = await ctx.prisma.event.findUniqueOrThrow({ where: { id } });
    return [e.startsAt.toISOString(), e.endsAt.toISOString()];
  };
  const snapshot = async () => ({
    venues: await ctx.prisma.location.findMany({
      select: { id: true, timeZone: true, timeZoneSource: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    events: await ctx.prisma.event.findMany({
      select: { id: true, startsAt: true, endsAt: true },
      orderBy: { id: 'asc' },
    }),
  });

  it('Eastern to Central keeps 7:00 PM local, cancelled events too; back restores the instants', async () => {
    const v = await venue();
    const a = await event(v, 'A', '2026-10-01T19:00:00-04:00', '2026-10-01T22:00:00-04:00');
    const b = await event(v, 'B', '2026-12-05T19:00:00-05:00', '2026-12-05T22:00:00-05:00');
    const c = await event(v, 'C', '2026-11-20T19:00:00-05:00', '2026-11-20T21:00:00-05:00');
    await asAdmin(ctx).post(`/events/${c.id}/cancel`).expect(200);

    const res = await patch(v, { timeZone: 'America/Chicago' }).expect(200);
    expect(res.body).toMatchObject({ timeZone: 'America/Chicago', timeZoneSource: 'ADMIN' });
    expect(await stored(a.id)).toEqual(['2026-10-02T00:00:00.000Z', '2026-10-02T03:00:00.000Z']);
    expect(await stored(b.id)).toEqual(['2026-12-06T01:00:00.000Z', '2026-12-06T04:00:00.000Z']);
    expect(await stored(c.id)).toEqual(['2026-11-21T01:00:00.000Z', '2026-11-21T03:00:00.000Z']);

    await patch(v, { timeZone: 'America/New_York' }).expect(200);
    expect(await stored(a.id)).toEqual([a.startsAt, a.endsAt]);
    expect(await stored(b.id)).toEqual([b.startsAt, b.endsAt]);
    expect(await stored(c.id)).toEqual([c.startsAt, c.endsAt]);
  });

  it.each(['confirmed', 'refunded', 'on a cancelled event'])(
    'an order (%s) refuses the change: 409 TIME_ZONE_HAS_ORDERS, nothing changed',
    async (kind) => {
      const v = await venue();
      const sold = await event(
        v,
        'Sold Show',
        '2026-10-01T19:00:00-04:00',
        '2026-10-01T22:00:00-04:00',
      );
      await event(v, 'Free Show', '2026-10-03T19:00:00-04:00', '2026-10-03T22:00:00-04:00');
      const { orderId } = await orderWithTickets(ctx, sold.id, { quantity: 1 });
      if (kind === 'refunded') {
        await ctx.prisma.order.update({
          where: { id: orderId },
          data: { status: 'REFUNDED', refundedAt: new Date() },
        });
      }
      if (kind === 'on a cancelled event') {
        await asAdmin(ctx).post(`/events/${sold.id}/cancel`).expect(200);
      }
      const before = await snapshot();
      const res = await patch(v, { timeZone: 'America/Chicago' }).expect(409);
      expect(res.body.error).toEqual({
        code: 'TIME_ZONE_HAS_ORDERS',
        message:
          "Can't change the time zone of Riverside: tickets have been sold for 1 of its events. " +
          "No customer's ticket time may move.",
        details: {
          timeZone: 'America/New_York',
          proposedTimeZone: 'America/Chicago',
          events: [{ id: sold.id, name: 'Sold Show' }],
          eventCount: 1,
        },
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it('Phoenix to Denver with an event at 2:30 AM on 2027-03-14: EVENT_TIME_NOT_IN_ZONE, SKIPPED', async () => {
    const v = await venue('phoenix');
    const e = await event(v, 'Late C', '2027-03-14T02:30:00-07:00', '2027-03-14T04:00:00-07:00');
    const before = await snapshot();
    const res = await patch(v, { timeZone: 'America/Denver' }).expect(409);
    expect(res.body.error).toEqual({
      code: 'EVENT_TIME_NOT_IN_ZONE',
      message:
        "Can't change the time zone: Late C's start, Mar 14, 2027, 2:30 AM, doesn't exist in " +
        'Mountain Time.',
      details: {
        event: { id: e.id, name: 'Late C' },
        field: 'startsAt',
        localTime: '2027-03-14T02:30',
        proposedTimeZone: 'America/Denver',
        reason: 'SKIPPED',
      },
    });
    expect(await snapshot()).toEqual(before);
  });

  it('Phoenix to Denver with an event at 1:30 AM on 2027-11-07: REPEATED', async () => {
    const v = await venue('phoenix');
    const e = await event(v, 'Fall Back', '2027-11-07T01:30:00-07:00', '2027-11-07T03:30:00-07:00');
    const res = await patch(v, { timeZone: 'America/Denver' }).expect(409);
    expect(res.body.error.code).toBe('EVENT_TIME_NOT_IN_ZONE');
    expect(res.body.error.message).toBe(
      "Can't change the time zone: Fall Back's start, Nov 7, 2027, 1:30 AM, happens twice in " +
        'Mountain Time.',
    );
    expect(res.body.error.details).toMatchObject({
      event: { id: e.id, name: 'Fall Back' },
      field: 'startsAt',
      reason: 'REPEATED',
    });
  });

  // #88 (020 review round 3, n1): a legacy event from before the zones adopted standard time has
  // no whole-minute offset; the change is refused with 409, not a 500, naming the zone that
  // can't place it.
  it('a legacy event dated before 1883: 409 EVENT_TIME_NOT_IN_ZONE, OUT_OF_RANGE, nothing changed', async () => {
    const v = await venue();
    const legacy = await ctx.prisma.event.create({
      data: {
        name: 'Old Show',
        locationId: v,
        startsAt: new Date('1880-06-01T23:00:00Z'),
        endsAt: new Date('1880-06-02T01:00:00Z'),
        totalTicketCapacity: 10,
        basePrice: '1.00',
      },
    });
    const before = await snapshot();
    const res = await patch(v, { timeZone: 'America/Chicago' }).expect(409);
    expect(res.body.error).toEqual({
      code: 'EVENT_TIME_NOT_IN_ZONE',
      message:
        "Can't change the time zone: Old Show's start, Jun 1, 1880, 6:03 PM, is from before " +
        'standard time in Eastern Time.',
      details: {
        event: { id: legacy.id, name: 'Old Show' },
        field: 'startsAt',
        localTime: '1880-06-01T18:03',
        proposedTimeZone: 'America/Chicago',
        reason: 'OUT_OF_RANGE',
      },
    });
    expect(await snapshot()).toEqual(before);
  });

  it('names an end time that is skipped', async () => {
    const v = await venue('phoenix');
    await event(v, 'Ends Late', '2027-03-14T00:30:00-07:00', '2027-03-14T02:15:00-07:00');
    const res = await patch(v, { timeZone: 'America/Denver' }).expect(409);
    expect(res.body.error.details).toMatchObject({ field: 'endsAt', reason: 'SKIPPED' });
    expect(res.body.error.message).toContain("Ends Late's end, Mar 14, 2027, 2:15 AM");
  });

  it('Phoenix to Denver bringing Late A and Late B within 60 minutes: SCHEDULING_CONFLICT', async () => {
    const v = await venue('phoenix');
    const a = await event(v, 'Late A', '2027-03-13T23:00:00-07:00', '2027-03-14T01:30:00-07:00');
    const b = await event(v, 'Late B', '2027-03-14T03:00:00-07:00', '2027-03-14T04:00:00-07:00');
    const before = await snapshot();
    const res = await patch(v, { timeZone: 'America/Denver' }).expect(409);
    expect(res.body.error.code).toBe('SCHEDULING_CONFLICT');
    expect(res.body.error.details).toEqual({
      bufferMinutes: 60,
      conflictingEvent: {
        id: a.id,
        name: 'Late A',
        startsAt: '2027-03-14T06:00:00.000Z',
        endsAt: '2027-03-14T08:30:00.000Z',
      },
      event: {
        id: b.id,
        name: 'Late B',
        startsAt: '2027-03-14T09:00:00.000Z',
        endsAt: '2027-03-14T10:00:00.000Z',
      },
    });
    expect(res.body.error.message).toBe(
      "Can't change the time zone: 'Late B' would start at Mar 14, 2027, 3:00 AM MDT, less than " +
        "60 minutes after 'Late A', committed from Mar 13, 2027, 11:00 PM MST to Mar 14, 2027, " +
        '1:30 AM MST.',
    );
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ['exactly 60 minutes apart after the move: 200', '03:30', 200],
    ['59 minutes apart after the move: 409', '03:29', 409],
  ])('the boundary pair %s', async (_label, bStart, status) => {
    const v = await venue('phoenix');
    // In Mountain time 01:30 MST is 08:30Z and 03:30 MDT is 09:30Z: 60 minutes; 03:29 is 59.
    await event(v, 'A', '2027-03-14T00:00:00-07:00', '2027-03-14T01:30:00-07:00');
    await event(v, 'B', `2027-03-14T${bStart}:00-07:00`, '2027-03-14T05:00:00-07:00');
    await patch(v, { timeZone: 'America/Denver' }).expect(status);
  });

  it('moves every event an hour later when consecutive ones are exactly 60 minutes apart (deferred)', async () => {
    const v = await venue();
    const created: { id: string; startsAt: string }[] = [];
    for (let i = 0; i < 4; i++) {
      // 3-hour events, each starting 4 hours after the last: exactly 60 minutes apart.
      const h = String(8 + i * 4).padStart(2, '0');
      const end = String(11 + i * 4).padStart(2, '0');
      created.push(
        await event(v, `E${i}`, `2026-10-10T${h}:00:00-04:00`, `2026-10-10T${end}:00:00-04:00`),
      );
    }
    await patch(v, { timeZone: 'America/Chicago' }).expect(200);
    for (const e of created) {
      // Each moves one hour later in UTC, keeping its local time.
      expect((await stored(e.id))[0]).toBe(
        new Date(Date.parse(e.startsAt) + 3_600_000).toISOString(),
      );
    }
  });

  it('refuses an explicit zone change on a venue with orders before the address lookup', async () => {
    const v = await venue();
    const e = await event(v, 'Sold', '2026-10-01T19:00:00-04:00', '2026-10-01T22:00:00-04:00');
    await orderWithTickets(ctx, e.id, { quantity: 1 });
    ctx.geocoder.reset();
    const res = await patch(v, {
      street: '937 Phillips Ln',
      city: 'Louisville',
      state: 'KY',
      zip: '40209',
      timeZone: 'America/Chicago',
    }).expect(409);
    expect(res.body.error.code).toBe('TIME_ZONE_HAS_ORDERS');
    expect(ctx.geocoder.calls).toHaveLength(0);
  });

  it('an address change that derives another zone follows the same rules', async () => {
    const v = await venue();
    const e = await event(v, 'Show', '2026-10-01T19:00:00-04:00', '2026-10-01T22:00:00-04:00');
    ctx.geocoder.placeAt(PLACES.phoenix);
    const res = await patch(v, PHOENIX_ADDRESS).expect(200);
    expect(res.body).toMatchObject({ timeZone: 'America/Phoenix', timeZoneSource: 'ADDRESS' });
    // 7:00 PM MST is 02:00Z.
    expect(await stored(e.id)).toEqual(['2026-10-02T02:00:00.000Z', '2026-10-02T05:00:00.000Z']);

    await orderWithTickets(ctx, e.id, { quantity: 1 });
    ctx.geocoder.reset();
    const refused = await patch(v, ADDRESS).expect(409);
    expect(refused.body.error.code).toBe('TIME_ZONE_HAS_ORDERS');
    const after = await ctx.prisma.location.findUniqueOrThrow({ where: { id: v } });
    expect([after.timeZone, after.city]).toEqual(['America/Phoenix', 'PHOENIX']);
  });

  it('maps an overlap found only at commit (the deferred constraint) to 409 SCHEDULING_CONFLICT', async () => {
    const v = await venue();
    const insert = (tx: Prisma.TransactionClient, name: string, start: string, end: string) =>
      tx.$executeRaw`
        INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt",
                             "totalTicketCapacity", "basePrice", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${name}, ${v}::uuid, ${start}::timestamptz,
                ${end}::timestamptz, 10, 1.00, now())`;
    const err = await ctx.prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`SET CONSTRAINTS "event_no_overlap" DEFERRED`;
        await insert(tx, 'A', '2026-10-01T23:00:00Z', '2026-10-02T02:00:00Z');
        await insert(tx, 'B', '2026-10-02T02:30:00Z', '2026-10-02T04:00:00Z');
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await ctx.prisma.event.count()).toBe(0);

    const out = { status: 0, body: undefined as unknown };
    const response = {
      status: (code: number) => ((out.status = code), response),
      json: (body: unknown) => ((out.body = body), response),
      setHeader: () => response,
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(err, host);
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({
      error: {
        code: 'SCHEDULING_CONFLICT',
        details: { bufferMinutes: 60, conflictingEvent: null },
      },
    });
  });
});
