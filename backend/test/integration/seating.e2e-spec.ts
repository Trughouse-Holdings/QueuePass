import type { Response } from 'supertest';
import { anon, as, asAdmin } from '../setup/authed-request';
import { customer, event, tier, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { AGENT, CUSTOMER, tokenFor } from '../setup/tokens';

/** Spec 007 FR-002, FR-004, FR-013 (research R5): reserved seating, tiers, and the seat map. */
describe('Reserved seating and the seat map', () => {
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

  const seating = (eventId: string, body: object) =>
    asAdmin(ctx).put(`/events/${eventId}/seating`).send(body);
  const seatMap = (eventId: string) => asAdmin(ctx).get(`/events/${eventId}/seats`).expect(200);
  const code = (res: Response): string => res.body.error?.code;

  /** A seated event with VIP (A) and General (B), and one seat sold in A. */
  const seatedWithSale = async () => {
    const eventId = await event(ctx, venueId, { capacity: 70 });
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 30);
    const general = await tier(ctx, eventId, 'General', '40.00', 40);
    await seating(eventId, {
      reservedSeating: true,
      sections: [
        { sectionId: sectionA, tierId: vip },
        { sectionId: sectionB, tierId: general },
      ],
    }).expect(200);
    await (
      await customer(ctx)
    )
      .post(`/events/${eventId}/orders`)
      .send({ tierId: vip, quantity: 1, seats: [{ sectionId: sectionA, row: 1, seat: 5 }] })
      .expect(201);
    return { eventId, vip, general };
  };

  it('turns reserved seating on at a venue with a layout and returns the seat map', async () => {
    const eventId = await event(ctx, venueId);
    const res = await seating(eventId, { reservedSeating: true, sections: [] }).expect(200);

    expect(res.body).toEqual({
      eventId,
      reservedSeating: true,
      sections: [
        {
          sectionId: sectionA,
          name: 'A',
          rows: 3,
          seatsPerRow: 10,
          tierId: null,
          sold: 0,
          taken: [],
        },
        {
          sectionId: sectionB,
          name: 'B',
          rows: 2,
          seatsPerRow: 20,
          tierId: null,
          sold: 0,
          taken: [],
        },
      ],
    });
    expect((await asAdmin(ctx).get(`/events/${eventId}`).expect(200)).body.reservedSeating).toBe(
      true,
    );
  });

  it('refuses reserved seating at a venue without a layout', async () => {
    const plain = await venue(ctx, 'Plain Hall');
    const eventId = await event(ctx, plain);
    const res = await seating(eventId, { reservedSeating: true, sections: [] });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('VALIDATION_FAILED');
  });

  it('refuses switching reserved seating either way once tickets are sold', async () => {
    const { eventId } = await seatedWithSale();
    const off = await seating(eventId, { reservedSeating: false, sections: [] });
    expect(off.status).toBe(409);
    expect(code(off)).toBe('EVENT_HAS_ORDERS');

    const gaEvent = await event(ctx, venueId);
    await (await customer(ctx)).post(`/events/${gaEvent}/orders`).send({ quantity: 1 }).expect(201);
    const on = await seating(gaEvent, { reservedSeating: true, sections: [] });
    expect(on.status).toBe(409);
    expect(code(on)).toBe('EVENT_HAS_ORDERS');
  });

  it("refuses another venue's section or another event's tier", async () => {
    const eventId = await event(ctx, venueId);
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 10);
    const elsewhere = await venue(ctx, 'Other Hall');
    const otherLayout = await asAdmin(ctx)
      .put(`/locations/${elsewhere}/layout`)
      .send({ sections: [{ name: 'Z', rows: 1, seatsPerRow: 5 }] })
      .expect(200);
    const otherEvent = await event(ctx, venueId);
    const otherTier = await tier(ctx, otherEvent, 'VIP', '120.00', 10);

    for (const sections of [
      [{ sectionId: otherLayout.body.sections[0].id, tierId: vip }],
      [{ sectionId: sectionA, tierId: otherTier }],
    ]) {
      const res = await seating(eventId, { reservedSeating: true, sections });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('VALIDATION_FAILED');
    }
  });

  it('keeps a section with sold seats in its tier, but maps unsold sections freely', async () => {
    const { eventId, vip, general } = await seatedWithSale();

    const retier = await seating(eventId, {
      reservedSeating: true,
      sections: [
        { sectionId: sectionA, tierId: general },
        { sectionId: sectionB, tierId: general },
      ],
    });
    expect(retier.status).toBe(409);
    expect(code(retier)).toBe('EVENT_HAS_ORDERS');

    const ok = await seating(eventId, {
      reservedSeating: true,
      sections: [
        { sectionId: sectionA, tierId: vip },
        { sectionId: sectionB, tierId: vip },
      ],
    }).expect(200);
    expect(ok.body.sections.map((s: { tierId: string }) => s.tierId)).toEqual([vip, vip]);
  });

  it('refuses changes to a cancelled event', async () => {
    const eventId = await event(ctx, venueId);
    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    const res = await seating(eventId, { reservedSeating: true, sections: [] });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('EVENT_CANCELLED');
  });

  it('shows sold seats and counts, and never who holds them', async () => {
    const { eventId, vip } = await seatedWithSale();

    const res = await seatMap(eventId);

    const [a, b] = res.body.sections;
    expect(a).toEqual({
      sectionId: sectionA,
      name: 'A',
      rows: 3,
      seatsPerRow: 10,
      tierId: vip,
      sold: 1,
      taken: [{ row: 1, seat: 5 }],
    });
    expect(b.sold).toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/customer|order|sub/i);
  });

  it("leaves an event's sections unmapped when the venue's layout is replaced", async () => {
    const eventId = await event(ctx, venueId);
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 10);
    await seating(eventId, {
      reservedSeating: true,
      sections: [{ sectionId: sectionA, tierId: vip }],
    }).expect(200);

    await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({ sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }] })
      .expect(200);

    const res = await seatMap(eventId);
    expect(res.body.sections.map((s: { tierId: string | null }) => s.tierId)).toEqual([null]);
  });

  it('unmaps sections whose tier is deleted while unsold', async () => {
    const eventId = await event(ctx, venueId);
    const vip = await tier(ctx, eventId, 'VIP', '120.00', 10);
    await seating(eventId, {
      reservedSeating: true,
      sections: [{ sectionId: sectionA, tierId: vip }],
    }).expect(200);

    await asAdmin(ctx).delete(`/events/${eventId}/tiers/${vip}`).expect(204);

    expect((await seatMap(eventId)).body.sections[0].tierId).toBeNull();
  });

  it('refuses moving a seated event to another venue', async () => {
    const eventId = await event(ctx, venueId);
    await seating(eventId, { reservedSeating: true, sections: [] }).expect(200);
    const elsewhere = await venue(ctx, 'Other Hall');

    const res = await asAdmin(ctx).patch(`/events/${eventId}`).send({ locationId: elsewhere });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('VALIDATION_FAILED');
  });

  it('lets anyone signed in read the seat map, and only admins change seating', async () => {
    const eventId = await event(ctx, venueId);
    for (const opts of [CUSTOMER, AGENT]) {
      const client = as(ctx, await tokenFor(opts));
      await client.get(`/events/${eventId}/seats`).expect(200);
      await client
        .put(`/events/${eventId}/seating`)
        .send({ reservedSeating: true, sections: [] })
        .expect(403);
    }
    await anon(ctx).get(`/events/${eventId}/seats`).expect(401);
  });
});
