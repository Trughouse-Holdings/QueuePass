import type { Response } from 'supertest';
import { anon, as, asAdmin } from '../setup/authed-request';
import { customer, event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/** Spec 007 US1 (FR-001, FR-003; research R3, R4): a venue's seating layout. */
describe('Seating layouts', () => {
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
    venueId = await venue(ctx, 'Seat Hall');
  });

  const A = { name: 'A', rows: 3, seatsPerRow: 10 };
  const B = { name: 'B', rows: 2, seatsPerRow: 20 };
  const put = (sections: object[], id = venueId) =>
    asAdmin(ctx).put(`/locations/${id}/layout`).send({ sections });
  const code = (res: Response): string => res.body.error?.code;

  /**
   * An event at the venue with reserved seating on and one valid seated ticket, written directly,
   * so this suite does not depend on seat ordering (US2).
   */
  const seatedEventWithSale = async (name = 'Season Opener') => {
    const eventId = await event(ctx, venueId, { name });
    const order = await (
      await customer(ctx)
    )
      .post(`/events/${eventId}/orders`)
      .send({ quantity: 1 })
      .expect(201);
    await ctx.prisma.ticket.update({
      where: { id: order.body.tickets[0].id },
      data: { seatSection: 'A', seatRow: 1, seatNumber: 1 },
    });
    await ctx.prisma.event.update({ where: { id: eventId }, data: { reservedSeating: true } });
    return eventId;
  };

  it('is empty for a venue without one', async () => {
    const res = await asAdmin(ctx).get(`/locations/${venueId}/layout`).expect(200);
    expect(res.body).toEqual({ locationId: venueId, totalSeats: 0, sections: [] });
  });

  it('saves sections in order with their total, and a second save replaces them', async () => {
    const saved = await put([A, B]).expect(200);
    expect(saved.body.totalSeats).toBe(70);
    expect(saved.body.sections.map((s: { name: string }) => s.name)).toEqual(['A', 'B']);
    expect(saved.body.sections[0]).toMatchObject(A);

    const read = await asAdmin(ctx).get(`/locations/${venueId}/layout`).expect(200);
    expect(read.body).toEqual(saved.body);

    const replaced = await put([{ name: 'Floor', rows: 5, seatsPerRow: 4 }]).expect(200);
    expect(replaced.body.totalSeats).toBe(20);
    expect(replaced.body.sections.map((s: { name: string }) => s.name)).toEqual(['Floor']);
  });

  it("refuses more seats than the venue's seating capacity", async () => {
    // The fixture venue seats 22,090; 100 rows of 200 is 20,000 per section.
    const big = { name: 'Big', rows: 100, seatsPerRow: 200 };
    const res = await put([big, { ...big, name: 'Bigger' }]);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('CAPACITY_EXCEEDED');
  });

  it('refuses names that repeat ignoring case, and sizes outside the limits', async () => {
    for (const sections of [
      [A, { ...B, name: 'a' }],
      [{ ...A, name: '' }],
      [{ ...A, name: 'x'.repeat(51) }],
      [{ ...A, rows: 0 }],
      [{ ...A, rows: 101 }],
      [{ ...A, seatsPerRow: 0 }],
      [{ ...A, seatsPerRow: 201 }],
      [],
      Array.from({ length: 51 }, (_, i) => ({ name: `S${i}`, rows: 1, seatsPerRow: 1 })),
    ]) {
      const res = await put(sections);
      expect(res.status).toBe(400);
      expect(code(res)).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a change while a scheduled seated event has valid tickets, and allows it after cancelling', async () => {
    await put([A, B]).expect(200);
    const eventId = await seatedEventWithSale();

    for (const res of [await put([A]), await asAdmin(ctx).delete(`/locations/${venueId}/layout`)]) {
      expect(res.status).toBe(409);
      expect(code(res)).toBe('LAYOUT_IN_USE');
      expect(res.body.error.details.events).toEqual([{ id: eventId, name: 'Season Opener' }]);
    }

    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    await put([A]).expect(200);
    await asAdmin(ctx).delete(`/locations/${venueId}/layout`).expect(204);
  });

  it('refuses removal while a scheduled event has reserved seating on, even with no sales', async () => {
    await put([A]).expect(200);
    const eventId = await event(ctx, venueId);
    await ctx.prisma.event.update({ where: { id: eventId }, data: { reservedSeating: true } });

    const res = await asAdmin(ctx).delete(`/locations/${venueId}/layout`);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('LAYOUT_IN_USE');
    // Replacing is fine: nothing is sold.
    await put([B]).expect(200);
  });

  it('removes a layout nothing depends on', async () => {
    await put([A]).expect(200);
    await asAdmin(ctx).delete(`/locations/${venueId}/layout`).expect(204);
    const res = await asAdmin(ctx).get(`/locations/${venueId}/layout`).expect(200);
    expect(res.body.sections).toEqual([]);
  });

  it("refuses lowering the venue's seating capacity below the layout's seats", async () => {
    await put([A, B]).expect(200);
    const res = await asAdmin(ctx).patch(`/locations/${venueId}`).send({ seatingCapacity: 69 });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('CAPACITY_EXCEEDED');
    await asAdmin(ctx).patch(`/locations/${venueId}`).send({ seatingCapacity: 70 }).expect(200);
  });

  it('answers 404 for an unknown venue', async () => {
    await asAdmin(ctx).get('/locations/7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40/layout').expect(404);
    await put([A], '7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40').expect(404);
  });

  it('lets anyone signed in read it, and only admins change it', async () => {
    await put([A]).expect(200);
    for (const opts of [CUSTOMER, AGENT]) {
      const client = as(ctx, await tokenFor(opts));
      await client.get(`/locations/${venueId}/layout`).expect(200);
      await client
        .put(`/locations/${venueId}/layout`)
        .send({ sections: [B] })
        .expect(403);
      await client.delete(`/locations/${venueId}/layout`).expect(403);
    }
    await anon(ctx).get(`/locations/${venueId}/layout`).expect(401);
  });
});
