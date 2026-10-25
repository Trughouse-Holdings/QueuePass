import { expectToMatchContract } from '../contract/expect-to-match-contract';
import { anon, as, asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, tier, venue, windowAt } from '../setup/fixtures';
import { PLACES } from '../setup/fake-geocoder';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { AGENT, tokenFor } from '../setup/tokens';

/** Spec 020: a venue placed in Phoenix by the fake address service (Arizona time). */
async function phoenixVenue(ctx: TestContext, name = 'Phoenix Hall'): Promise<string> {
  ctx.geocoder.placeAt(PLACES.phoenix);
  const res = await asAdmin(ctx)
    .post('/locations')
    .send({
      name,
      street: '201 E Jefferson St',
      city: 'Phoenix',
      state: 'AZ',
      zip: '85004',
      seatingCapacity: 500,
    })
    .expect(201);
  ctx.geocoder.reset();
  return res.body.id;
}

/** Spec 006 US3 (FR-007, SC-003; research R4): a customer's own orders, and no one else's. */
describe('My orders', () => {
  let ctx: TestContext;
  let venueId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Yum Center');
  });

  const buy = async (eventId: string, body: object, n = 1) =>
    (await customer(ctx, n))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, ...body })
      .expect(201);
  const mine = async (n = 1) => (await customer(ctx, n)).get('/me/orders').expect(200);

  it("lists the customer's orders newest first, with tickets and an event summary", async () => {
    const opener = await event(ctx, venueId, { name: 'Opener' });
    const vip = await tier(ctx, opener, 'VIP', '120.00', 10);
    const later = await event(ctx, venueId, { name: 'Later', basePrice: '20.00' });
    const first = await buy(opener, { tierId: vip, quantity: 2 });
    const second = await buy(later, { quantity: 1 });

    const res = await mine();

    expect(res.body.map((o: { id: string }) => o.id)).toEqual([second.body.id, first.body.id]);
    expect(res.body[1]).toMatchObject({
      tierName: 'VIP',
      quantity: 2,
      totalPrice: '240.00',
      status: 'CONFIRMED',
      event: {
        id: opener,
        name: 'Opener',
        status: 'SCHEDULED',
        location: { id: venueId, name: 'Yum Center' },
      },
    });
    expect(res.body[1].tickets.map((t: { code: string }) => t.code).sort()).toEqual(
      first.body.tickets.map((t: { code: string }) => t.code).sort(),
    );
  });

  it("carries the event's venue zone for each order (spec 020 FR-021, R16)", async () => {
    const phoenix = await phoenixVenue(ctx);
    const eastEvent = await event(ctx, venueId);
    const westEvent = await event(ctx, phoenix, windowAt(380, 19, 'America/Phoenix'));
    await buy(eastEvent, { quantity: 1 });
    await buy(westEvent, { quantity: 1 });
    const zones = Object.fromEntries(
      (await mine()).body.map((o: { event: { id: string; location: { timeZone: string } } }) => [
        o.event.id,
        o.event.location.timeZone,
      ]),
    );
    expect(zones).toEqual({ [eastEvent]: 'America/New_York', [westEvent]: 'America/Phoenix' });
  });

  it("never shows one customer another customer's orders", async () => {
    const eventId = await event(ctx, venueId);
    await buy(eventId, { quantity: 1 }, 1);

    expect((await mine(2)).body).toEqual([]);
    expect((await mine(1)).body).toHaveLength(1);
  });

  it('shows a cancelled event as cancelled, its order refunded, and its tickets void', async () => {
    const eventId = await event(ctx, venueId);
    await buy(eventId, { quantity: 2 });
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);

    const [order] = (await mine()).body;

    expect(order.status).toBe('REFUNDED');
    expect(order.refundedAt).not.toBeNull();
    expect(order.event.status).toBe('CANCELLED');
    expect(order.tickets.map((t: { status: string }) => t.status)).toEqual(['VOID', 'VOID']);
  });

  it('shows when a ticket was checked in', async () => {
    const eventId = await event(ctx, venueId);
    const placed = await buy(eventId, { quantity: 1 });
    const at = new Date();
    await ctx.prisma.ticket.update({
      where: { id: placed.body.tickets[0].id },
      data: { checkedInAt: at },
    });

    const [order] = (await mine()).body;

    expect(new Date(order.tickets[0].checkedInAt).getTime()).toBe(at.getTime());
  });

  it("leaves out orders placed under a stand-in subject, as the demo script's are", async () => {
    const eventId = await event(ctx, venueId);
    const standIn = await tokenFor({
      username: 'customer1',
      roles: ['customer'],
      sub: 'demo-customer1',
    });
    await as(ctx, standIn)
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: 1 })
      .expect(201);

    expect((await mine(1)).body).toEqual([]);
  });

  /** Spec 019 FR-012 (research R2): each order's event summary carries its venue's address. */
  describe('the venue address (spec 019)', () => {
    it("sends the venue's one-line address for a venue with address parts", async () => {
      const eventId = await event(ctx, venueId);
      await buy(eventId, { quantity: 1 });
      const venueRow = await ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } });

      const [order] = (await mine()).body;

      expect(venueRow.street).not.toBeNull();
      expect(order.event.location).toEqual({
        id: venueId,
        name: 'Yum Center',
        address: '430 W VINE ST, LEXINGTON, KY 40507',
        // Spec 020 FR-021 (research R16).
        timeZone: 'America/New_York',
      });
      expect(order.event.location.address).toBe(venueRow.address);
    });

    it('sends the stored text for a venue from before 013 (no address parts)', async () => {
      const legacy = await ctx.prisma.location.create({
        data: {
          name: 'Old Hall',
          address: '1 Demo Plaza, Louisville, KY',
          seatingCapacity: 500,
          timeZone: 'America/New_York',
          timeZoneSource: 'DEFAULT',
        },
      });
      const eventId = await event(ctx, legacy.id);
      await buy(eventId, { quantity: 1 });

      const [order] = (await mine()).body;

      expect(legacy.street).toBeNull();
      expect(order.event.location).toEqual({
        id: legacy.id,
        name: 'Old Hall',
        address: '1 Demo Plaza, Louisville, KY',
        timeZone: 'America/New_York',
      });
    });

    it('gives each order its own venue address', async () => {
      const other = (
        await asAdmin(ctx)
          .post('/locations')
          .send({
            name: 'River Hall',
            street: '1 Arena Plaza',
            city: 'Louisville',
            state: 'KY',
            zip: '40202',
            seatingCapacity: 1000,
          })
          .expect(201)
      ).body.id;
      const here = await event(ctx, venueId, { name: 'Here' });
      const there = await event(ctx, other, { name: 'There' });
      await buy(here, { quantity: 1 });
      await buy(there, { quantity: 1 });

      const byName = Object.fromEntries(
        (await mine()).body.map((o: { event: { name: string; location: unknown } }) => [
          o.event.name,
          o.event.location,
        ]),
      );

      expect(byName).toEqual({
        Here: { id: venueId, name: 'Yum Center', address: '430 W VINE ST, LEXINGTON, KY 40507' },
        There: { id: other, name: 'River Hall', address: '1 ARENA PLAZA, LOUISVILLE, KY 40202' },
      });
    });

    it('matches the contract, address included, for every response', async () => {
      const eventId = await event(ctx, venueId);
      await buy(eventId, { quantity: 1 });

      const res = await (await customer(ctx, 1)).get('/me/orders').expect(200);

      expectToMatchContract(res, 'listMyOrders');
      expect(typeof res.body[0].event.location.address).toBe('string');
    });
  });

  it('refuses admins and gate agents, and requests without a token', async () => {
    await asAdmin(ctx).get('/me/orders').expect(403);
    await as(ctx, await tokenFor(AGENT))
      .get('/me/orders')
      .expect(403);
    await anon(ctx).get('/me/orders').expect(401);
  });
});
