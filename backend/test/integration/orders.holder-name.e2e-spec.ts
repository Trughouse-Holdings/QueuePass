import { randomUUID } from 'node:crypto';
import { asAdmin } from '../setup/authed-request';
import { customer, event, orderWithTickets, reserveThenOrder, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { tokenFor } from '../setup/tokens';

/**
 * Spec 017 US4 (FR-001–FR-004, SC-006; research R2): every new order carries one valid holder's
 * name, refused with 400 HOLDER_NAME_INVALID otherwise, contract-checked.
 */
describe('Orders carry a holder name', () => {
  let ctx: TestContext;
  let venueId: string;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx);
    eventId = await event(ctx, venueId);
  });

  const order = async (body: object) =>
    (await customer(ctx)).post(`/events/${eventId}/orders`).send(body);

  it.each([
    [{ quantity: 1 }, 'MISSING'],
    [{ quantity: 1, holderName: '   ' }, 'MISSING'],
    [{ quantity: 1, holderName: 'a'.repeat(101) }, 'TOO_LONG'],
    [{ quantity: 1, holderName: 'Jordan\tLee' }, 'CONTROL_CHARACTER'],
    [{ quantity: 1, holderName: '1234' }, 'NO_LETTER'],
  ])('refuses %j with 400 HOLDER_NAME_INVALID %s, recording nothing', async (body, reason) => {
    const res = await order(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('HOLDER_NAME_INVALID');
    expect(res.body.error.details.reason).toBe(reason);
    expect(await ctx.prisma.order.count()).toBe(0);
    expect(await ctx.prisma.ticket.count()).toBe(0);
  });

  it('accepts exactly 100 code points', async () => {
    const res = await order({ quantity: 1, holderName: `a${'😀'.repeat(99)}` });
    expect(res.status).toBe(201);
  });

  it('stores and returns the trimmed name with inner spaces kept, in NFC', async () => {
    const res = await order({ quantity: 1, holderName: '  Jordan  Lee ' });
    expect(res.status).toBe(201);
    expect(res.body.holderName).toBe('Jordan  Lee');

    const nfc = await order({ quantity: 1, holderName: 'José' });
    expect(nfc.status).toBe(201);
    expect(nfc.body.holderName).toBe('José');
    const row = await ctx.prisma.order.findUniqueOrThrow({ where: { id: nfc.body.id } });
    expect(row.holderName).toBe('José');
  });

  it('replays a repeated requestId with the same name, and refuses a different name', async () => {
    const requestId = randomUUID();
    const first = await order({ quantity: 1, holderName: 'Jordan Lee', requestId });
    expect(first.status).toBe(201);

    const same = await order({ quantity: 1, holderName: 'Jordan Lee', requestId });
    expect(same.status).toBe(200);
    expect(same.body.id).toBe(first.body.id);

    const different = await order({ quantity: 1, holderName: 'Someone Else', requestId });
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('REQUEST_ID_REUSED');
  });

  it('returns holderName in createOrder, listMyOrders, and listAttendees', async () => {
    const res = await order({ quantity: 2, holderName: 'Jordan Lee' });
    expect(res.status).toBe(201);
    expect(res.body.holderName).toBe('Jordan Lee');

    const mine = await (await customer(ctx)).get('/me/orders').expect(200);
    expect(mine.body[0].holderName).toBe('Jordan Lee');

    const attendees = await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);
    expect(attendees.body[0].holderName).toBe('Jordan Lee');
  });

  it('returns holderName null for an order inserted without a name (before 017)', async () => {
    await orderWithTickets(ctx, eventId, { quantity: 1, holderName: null });
    const attendees = await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);
    expect(attendees.body[0].holderName).toBeNull();
  });

  it('a seated order (reserveThenOrder) carries the name too', async () => {
    const seatedVenue = await venue(ctx, 'Seated Hall');
    await asAdmin(ctx)
      .put(`/locations/${seatedVenue}/layout`)
      .send({ sections: [{ name: 'A', rows: 2, seatsPerRow: 5 }] })
      .expect(200);
    const seatedEvent = await event(ctx, seatedVenue, { capacity: 10 });
    const general = await tier(ctx, seatedEvent, 'General', '30.00', 10);
    const sections = await ctx.prisma.section.findMany({ where: { locationId: seatedVenue } });
    await asAdmin(ctx)
      .put(`/events/${seatedEvent}/seating`)
      .send({ reservedSeating: true, sections: [{ sectionId: sections[0].id, tierId: general }] })
      .expect(200);

    const token = await tokenFor({ username: 'customer1', roles: ['customer'] });
    const res = await reserveThenOrder(ctx, token, seatedEvent, {
      tierId: general,
      seats: [{ sectionId: sections[0].id, row: 1, seat: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.holderName).toBe('Test Holder');
  });
});
