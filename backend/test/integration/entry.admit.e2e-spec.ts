import { randomUUID } from 'node:crypto';
import { asAdmin } from '../setup/authed-request';
import { agent, customer, eventAroundNow, orderWithTickets, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor } from '../setup/tokens';
import { PLACES } from '../setup/fake-geocoder';

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

/** Spec 017 US1 (FR-015, FR-015a, FR-018): admitTicket, contract-checked. */
describe('admitTicket', () => {
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
    eventId = await eventAroundNow(ctx, venueId, { startsInSeconds: 3600, lastsSeconds: 10800 });
  });

  const admit = async (ticketId: string, wholeOrder = false, n = 1) =>
    (await agent(ctx, n)).post(`/events/${eventId}/entry/admit`).send({ ticketId, wholeOrder });
  const lookup = async (code: string) =>
    (await agent(ctx)).post(`/events/${eventId}/entry/lookup`).send({ code });

  it('records one entry: time, agent subject, and agent username (FR-015)', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const res = await admit(tickets[0].id);
    expect(res.status).toBe(200);
    expect(res.body.admitted).toEqual([
      { ticketId: tickets[0].id, code: tickets[0].code, usedAt: expect.any(String) },
    ]);
    expect(res.body.alreadyUsed).toEqual([]);

    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(row.checkedInAt).not.toBeNull();
    expect(row.checkedInBySub).toBe(subFor('agent1'));
    expect(row.checkedInByUsername).toBe('agent1');
  });

  it('shows the ticket as USED with usedAt on the next lookup', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const admitted = await admit(tickets[0].id);
    const res = await lookup(tickets[0].code);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('USED');
    expect(res.body.usedAt).toBe(admitted.body.admitted[0].usedAt);
  });

  it('refuses a second admit as 409 ENTRY_REFUSED with reason USED and usedAt (FR-018)', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const first = await admit(tickets[0].id);
    const second = await admit(tickets[0].id, false, 2);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ENTRY_REFUSED');
    expect(second.body.error.details.reason).toBe('USED');
    expect(second.body.error.details.usedAt).toBe(first.body.admitted[0].usedAt);
  });

  it('admits a fresh order of 4 with wholeOrder (FR-015a)', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 4 });
    const res = await admit(tickets[0].id, true);
    expect(res.status).toBe(200);
    expect(res.body.admitted).toHaveLength(4);
    expect(res.body.alreadyUsed).toEqual([]);
    expect(new Set(res.body.admitted.map((t: { ticketId: string }) => t.ticketId))).toEqual(
      new Set(tickets.map((t) => t.id)),
    );
  });

  it('wholeOrder admits 3 and lists the used 4th in alreadyUsed', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 4 });
    const first = await admit(tickets[3].id);
    const res = await admit(tickets[0].id, true, 2);
    expect(res.status).toBe(200);
    expect(res.body.admitted).toHaveLength(3);
    expect(res.body.alreadyUsed).toEqual([
      { ticketId: tickets[3].id, code: tickets[3].code, usedAt: first.body.admitted[0].usedAt },
    ]);
  });

  it("never admits another order's tickets, even the same customer's at this event", async () => {
    const mine = await orderWithTickets(ctx, eventId, { quantity: 2, customer: 1 });
    const other = await orderWithTickets(ctx, eventId, { quantity: 2, customer: 1 });
    const res = await admit(mine.tickets[0].id, true);
    expect(res.status).toBe(200);
    expect(res.body.admitted).toHaveLength(2);
    for (const t of other.tickets) {
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.checkedInAt).toBeNull();
    }
  });

  it('admits a ticket of an order with no name once, then refuses it as used (SC-007)', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1, holderName: null });
    expect((await admit(tickets[0].id)).status).toBe(200);
    const again = await admit(tickets[0].id);
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('USED');
  });

  it('is 404 TICKET_NOT_FOUND for an unknown ticketId', async () => {
    const res = await admit(randomUUID());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
  });

  it('is 404 NOT_FOUND for an unknown event', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 1 });
    const res = await (
      await agent(ctx)
    )
      .post(`/events/${randomUUID()}/entry/admit`)
      .send({ ticketId: tickets[0].id, wholeOrder: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // T042 (US6, FR-020, FR-021, SC-005): real entries reach the report, the attendee list, and
  // the buyer's own orders.
  it('after two admits, the report counts 2 more, and attendees and My orders show the times', async () => {
    const { tickets } = await orderWithTickets(ctx, eventId, { quantity: 2 });
    const before = await asAdmin(ctx).get('/reports/sales').expect(200);
    const was =
      before.body.events.find((e: { eventId: string }) => e.eventId === eventId)?.checkedIn ?? 0;

    await admit(tickets[0].id);
    await admit(tickets[1].id, false, 2);

    const report = await asAdmin(ctx).get('/reports/sales').expect(200);
    const line = report.body.events.find((e: { eventId: string }) => e.eventId === eventId);
    expect(line.checkedIn).toBe(was + 2);

    const attendees = await asAdmin(ctx).get(`/events/${eventId}/attendees`).expect(200);
    const listed = attendees.body.flatMap((o: { tickets: { checkedInAt: string | null }[] }) =>
      o.tickets.filter((t) => t.checkedInAt !== null),
    );
    expect(listed).toHaveLength(2);

    const my = await (await customer(ctx)).get('/me/orders').expect(200);
    const myTickets = my.body.flatMap((o: { tickets: { checkedInAt: string | null }[] }) =>
      o.tickets.filter((t) => t.checkedInAt !== null),
    );
    expect(myTickets).toHaveLength(2);
  });

  it("names another venue's zone for a ticket of its event: lookup and OTHER_EVENT (spec 020 R16)", async () => {
    const other = await eventAroundNow(ctx, await phoenixVenue(ctx), {
      startsInSeconds: 3600,
      lastsSeconds: 10800,
      name: 'Desert Show',
    });
    const { tickets } = await orderWithTickets(ctx, other, { quantity: 1 });
    const look = await lookup(tickets[0].code);
    expect(look.status).toBe(200);
    expect(look.body.state).toBe('OTHER_EVENT');
    expect(look.body.event).toMatchObject({ name: 'Desert Show', timeZone: 'America/Phoenix' });
    const refused = await admit(tickets[0].id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toMatchObject({
      reason: 'OTHER_EVENT',
      event: { name: 'Desert Show', timeZone: 'America/Phoenix' },
    });
  });
});
