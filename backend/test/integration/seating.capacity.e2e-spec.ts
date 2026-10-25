import type { Response } from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 007 FR-006, FR-018, FR-019 (research R11): in the seated flow, the event's capacity and its
 * tiers' amounts are calculated from the layout, never typed.
 */
describe('Calculated capacities in the seated flow', () => {
  let ctx: TestContext;
  let venueId: string;
  let sectionA: string;
  let sectionB: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Seat Hall');
    const layout = await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({
        sections: [
          { name: 'A', rows: 3, seatsPerRow: 10 },
          { name: 'B', rows: 2, seatsPerRow: 20 },
        ],
      })
      .expect(200);
    [sectionA, sectionB] = layout.body.sections.map((s: { id: string }) => s.id);
  });

  const code = (res: Response): string => res.body.error?.code;
  const seating = (eventId: string, body: object) =>
    asAdmin(ctx).put(`/events/${eventId}/seating`).send(body);
  const getEvent = async (id: string) => (await asAdmin(ctx).get(`/events/${id}`).expect(200)).body;
  const tiersOf = async (id: string) =>
    (await asAdmin(ctx).get(`/events/${id}/tiers`).expect(200)).body as {
      id: string;
      name: string;
      quantity: number;
    }[];
  const addTier = (eventId: string, body: object) =>
    asAdmin(ctx).post(`/events/${eventId}/tiers`).send(body);

  it("gives a new event the venue's capacity when it is left out", async () => {
    const res = await asAdmin(ctx)
      .post('/events')
      .send({
        name: 'Blank Capacity',
        locationId: venueId,
        startsAt: '2030-05-01T14:00:00-04:00',
        endsAt: '2030-05-01T17:00:00-04:00',
        basePrice: '10.00',
      })
      .expect(201);
    expect(res.body.totalTicketCapacity).toBe(70);
  });

  it("sets the event's capacity to the layout total when reserved seating turns on", async () => {
    const eventId = await event(ctx, venueId, { capacity: 12 });
    await seating(eventId, { reservedSeating: true, sections: [] }).expect(200);
    expect((await getEvent(eventId)).totalTicketCapacity).toBe(70);
  });

  it("calculates each seated tier's amount from its sections, and recalculates on remap", async () => {
    const eventId = await event(ctx, venueId, { capacity: 70 });
    await seating(eventId, { reservedSeating: true, sections: [] }).expect(200);
    const vip = (await addTier(eventId, { name: 'VIP', price: '120.00' }).expect(201)).body;
    const gen = (await addTier(eventId, { name: 'General', price: '40.00' }).expect(201)).body;
    expect([vip.quantity, gen.quantity]).toEqual([0, 0]);

    await seating(eventId, {
      reservedSeating: true,
      sections: [
        { sectionId: sectionA, tierId: vip.id },
        { sectionId: sectionB, tierId: gen.id },
      ],
    }).expect(200);
    expect(Object.fromEntries((await tiersOf(eventId)).map((t) => [t.name, t.quantity]))).toEqual({
      VIP: 30,
      General: 40,
    });

    await seating(eventId, {
      reservedSeating: true,
      sections: [
        { sectionId: sectionA, tierId: vip.id },
        { sectionId: sectionB, tierId: vip.id },
      ],
    }).expect(200);
    expect(Object.fromEntries((await tiersOf(eventId)).map((t) => [t.name, t.quantity]))).toEqual({
      VIP: 70,
      General: 0,
    });
  });

  it("drops seated tiers to 0 when the venue's layout is replaced", async () => {
    const eventId = await event(ctx, venueId, { capacity: 70 });
    await seating(eventId, { reservedSeating: true, sections: [] }).expect(200);
    const vip = (await addTier(eventId, { name: 'VIP', price: '120.00' }).expect(201)).body;
    await seating(eventId, {
      reservedSeating: true,
      sections: [{ sectionId: sectionA, tierId: vip.id }],
    }).expect(200);

    await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({ sections: [{ name: 'Floor', rows: 5, seatsPerRow: 10 }] })
      .expect(200);

    expect((await tiersOf(eventId))[0].quantity).toBe(0);
    expect((await getEvent(eventId)).totalTicketCapacity).toBe(50);
  });

  it('keeps the numbers when reserved seating turns off, and they can be typed again', async () => {
    const eventId = await event(ctx, venueId, { capacity: 70 });
    await seating(eventId, { reservedSeating: true, sections: [] }).expect(200);
    const vip = (await addTier(eventId, { name: 'VIP', price: '120.00' }).expect(201)).body;
    await seating(eventId, {
      reservedSeating: true,
      sections: [{ sectionId: sectionA, tierId: vip.id }],
    }).expect(200);

    await seating(eventId, { reservedSeating: false, sections: [] }).expect(200);

    expect((await getEvent(eventId)).totalTicketCapacity).toBe(70);
    expect((await tiersOf(eventId))[0].quantity).toBe(30);
    await asAdmin(ctx)
      .patch(`/events/${eventId}/tiers/${vip.id}`)
      .send({ quantity: 20 })
      .expect(200);
    await asAdmin(ctx).patch(`/events/${eventId}`).send({ totalTicketCapacity: 60 }).expect(200);
  });

  it('refuses typed amounts on a seated event', async () => {
    const eventId = await event(ctx, venueId, { capacity: 70 });
    await seating(eventId, { reservedSeating: true, sections: [] }).expect(200);
    const vip = (await addTier(eventId, { name: 'VIP', price: '120.00' }).expect(201)).body;

    for (const res of [
      await asAdmin(ctx).patch(`/events/${eventId}`).send({ totalTicketCapacity: 50 }),
      await addTier(eventId, { name: 'General', price: '40.00', quantity: 10 }),
      await asAdmin(ctx).patch(`/events/${eventId}/tiers/${vip.id}`).send({ quantity: 10 }),
    ]) {
      expect(res.status).toBe(400);
      expect(code(res)).toBe('VALIDATION_FAILED');
    }
    // Name and price still change.
    await asAdmin(ctx)
      .patch(`/events/${eventId}/tiers/${vip.id}`)
      .send({ price: '125.00' })
      .expect(200);
  });

  it('still requires a typed quantity on a general-admission event', async () => {
    const eventId = await event(ctx, venueId, { capacity: 70 });
    const res = await addTier(eventId, { name: 'General', price: '40.00' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('VALIDATION_FAILED');
  });
});
