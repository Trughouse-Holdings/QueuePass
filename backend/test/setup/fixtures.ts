import { as, asAdmin } from './authed-request';
import type { TestContext } from './test-app';
import { tokenFor } from './tokens';

/** Shared setup for spec 005 tests: venues, events, tiers, and orders through the real API. */

let day = 0;
/** A fresh, non-overlapping three-hour window for each event a test creates. */
function nextWindow(): { startsAt: string; endsAt: string } {
  day += 1;
  const start = new Date(Date.UTC(2027, 0, 1, 18) + day * 86_400_000);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
  };
}

export async function venue(ctx: TestContext, name = 'Yum Center'): Promise<string> {
  const res = await asAdmin(ctx)
    .post('/locations')
    .send({ name, address: '1 Arena Plaza', seatingCapacity: 22090 })
    .expect(201);
  return res.body.id;
}

export async function event(
  ctx: TestContext,
  locationId: string,
  opts: {
    name?: string;
    capacity?: number;
    basePrice?: string;
    startsAt?: string;
    endsAt?: string;
  } = {},
): Promise<string> {
  const window = opts.startsAt && opts.endsAt ? opts : nextWindow();
  const res = await asAdmin(ctx)
    .post('/events')
    .send({
      name: opts.name ?? 'Season Opener',
      locationId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      totalTicketCapacity: opts.capacity ?? 100,
      basePrice: opts.basePrice ?? '45.00',
    })
    .expect(201);
  return res.body.id;
}

export async function tier(
  ctx: TestContext,
  eventId: string,
  name: string,
  price: string,
  quantity: number,
): Promise<string> {
  const res = await asAdmin(ctx)
    .post(`/events/${eventId}/tiers`)
    .send({ name, price, quantity })
    .expect(201);
  return res.body.id;
}

/** A signed-in customer client, `customer<n>`. */
export async function customer(ctx: TestContext, n = 1) {
  return as(ctx, await tokenFor({ username: `customer${n}`, roles: ['customer'] }));
}
