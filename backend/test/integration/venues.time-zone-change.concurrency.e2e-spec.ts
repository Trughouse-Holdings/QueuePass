import { toLocalDateTime } from '@queuepass/shared';
import { asAdmin } from '../setup/authed-request';
import { ADDRESS, customer, HOLDER, windowAt } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 020 FR-013 (research R8, R10): a zone change is all or nothing under genuinely concurrent
 * requests. Each case runs 10 times.
 */
const RUNS = 10;
const DENVER_ADDRESS = { street: '1701 Bryant St', city: 'Denver', state: 'CO', zip: '80204' };

describe('Venue time zone changes under concurrency (spec 020 FR-013)', () => {
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

  async function setup(): Promise<{ venueId: string; eventId: string; local: string }> {
    await resetDb(ctx.prisma);
    ctx.geocoder.reset();
    const v = await asAdmin(ctx)
      .post('/locations')
      .send({ name: 'Riverside', ...ADDRESS, seatingCapacity: 500 })
      .expect(201);
    const w = windowAt(60, 19);
    const e = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Show',
        locationId: v.body.id,
        ...w,
        totalTicketCapacity: 50,
        basePrice: '1.00',
      })
      .expect(201);
    return { venueId: v.body.id, eventId: e.body.id, local: w.startsAt.slice(0, 16) };
  }

  const zoneChange = (id: string, body: object) =>
    asAdmin(ctx).patch(`/locations/${id}`).send(body);
  const storedLocal = async (eventId: string) => {
    const e = await ctx.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: { location: true },
    });
    return toLocalDateTime(e.startsAt, e.location.timeZone);
  };

  it('a zone change racing an order: the order first and the change refused, or the change first', async () => {
    const buyer = await customer(ctx);
    for (let i = 0; i < RUNS; i++) {
      const { venueId, eventId, local } = await setup();
      const [change, order] = await Promise.all([
        zoneChange(venueId, { timeZone: 'America/Chicago' }),
        buyer.post(`/events/${eventId}/orders`).send({ holderName: HOLDER, quantity: 1 }),
      ]);
      expect(order.status).toBe(201);
      expect([200, 409]).toContain(change.status);
      const venue = await ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } });
      if (change.status === 409) {
        expect(change.body.error.code).toBe('TIME_ZONE_HAS_ORDERS');
        expect(venue.timeZone).toBe('America/New_York');
      } else {
        expect(venue.timeZone).toBe('America/Chicago');
      }
      // Either way the event keeps its local time in the venue's final zone.
      expect(await storedLocal(eventId)).toBe(local);
      expect(await ctx.prisma.order.count()).toBe(1);
    }
  });

  it('a zone change racing an event create: moved with the others, or refused', async () => {
    for (let i = 0; i < RUNS; i++) {
      const { venueId } = await setup();
      const w = windowAt(70, 19);
      const [change, created] = await Promise.all([
        zoneChange(venueId, { timeZone: 'America/Chicago' }),
        asAdmin(ctx)
          .post('/events')
          .send({
            name: 'Racer',
            locationId: venueId,
            ...w,
            totalTicketCapacity: 5,
            basePrice: '1.00',
          }),
      ]);
      expect(change.status).toBe(200);
      if (created.status === 201) {
        expect(await storedLocal(created.body.id)).toBe(w.startsAt.slice(0, 16));
      } else {
        expect(created.status).toBe(400);
        expect(created.body.error.code).toBe('UTC_OFFSET_MISMATCH');
        expect(await ctx.prisma.event.count({ where: { name: 'Racer' } })).toBe(0);
      }
    }
  });

  it('a zone change racing an event update never surfaces a deadlock as a 500', async () => {
    for (let i = 0; i < RUNS; i++) {
      const { venueId, eventId } = await setup();
      const [change, updated] = await Promise.all([
        zoneChange(venueId, { timeZone: 'America/Chicago' }),
        asAdmin(ctx)
          .patch(`/events/${eventId}`)
          .send({ name: `Renamed ${i}`, basePrice: '2.00' }),
      ]);
      expect(change.status).toBe(200);
      expect(updated.status).toBe(200);
    }
  });

  it('an explicit change committing while an address change waits on its lookup (M2)', async () => {
    for (let i = 0; i < RUNS; i++) {
      const { venueId, eventId, local } = await setup();
      ctx.geocoder.placeAt(PLACES.denver);
      const gate = ctx.geocoder.pause();
      const address = zoneChange(venueId, DENVER_ADDRESS).then((r) => r);
      await gate.started;
      let first;
      try {
        first = await zoneChange(venueId, { timeZone: 'America/Chicago' });
      } finally {
        // Never leave the paused lookup waiting, even when the assertion below fails.
        gate.release();
      }
      expect(first.status).toBe(200);
      const res = await address;
      expect(res.status).toBe(200);
      const venue = await ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } });
      expect([venue.timeZone, venue.timeZoneSource]).toEqual(['America/Denver', 'ADDRESS']);
      // Converted from Chicago, the zone the first change left: still 19:00, never 20:00.
      expect(await storedLocal(eventId)).toBe(local);
    }
  });

  it('an explicit change racing an address change: 19:00 local in the final zone', async () => {
    for (let i = 0; i < RUNS; i++) {
      const { venueId, eventId, local } = await setup();
      ctx.geocoder.placeAt(PLACES.denver);
      const [a, b] = await Promise.all([
        zoneChange(venueId, { timeZone: 'America/Chicago' }),
        zoneChange(venueId, DENVER_ADDRESS),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const venue = await ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } });
      const expected =
        venue.timeZone === 'America/Chicago'
          ? ['America/Chicago', 'ADMIN']
          : ['America/Denver', 'ADDRESS'];
      expect([venue.timeZone, venue.timeZoneSource]).toEqual(expected);
      expect(await storedLocal(eventId)).toBe(local);
    }
  });

  it('two explicit changes racing: 19:00 local in the final zone', async () => {
    for (let i = 0; i < RUNS; i++) {
      const { venueId, eventId, local } = await setup();
      const [a, b] = await Promise.all([
        zoneChange(venueId, { timeZone: 'America/Chicago' }),
        zoneChange(venueId, { timeZone: 'America/Denver' }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const venue = await ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } });
      expect(['America/Chicago', 'America/Denver']).toContain(venue.timeZone);
      expect(await storedLocal(eventId)).toBe(local);
    }
  });

  it('a zone change racing the delete of a cancelled event: no 404 or 500 (m2)', async () => {
    for (let i = 0; i < RUNS; i++) {
      const { venueId, eventId } = await setup();
      await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
      const [change, deleted] = await Promise.all([
        zoneChange(venueId, { timeZone: 'America/Chicago' }),
        asAdmin(ctx).delete(`/events/${eventId}`),
      ]);
      expect(change.status).toBe(200);
      expect(deleted.status).toBe(204);
    }
  });
});
