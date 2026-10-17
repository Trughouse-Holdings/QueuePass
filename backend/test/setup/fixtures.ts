import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { as, asAdmin } from './authed-request';
import type { TestContext } from './test-app';
import { tokenFor } from './tokens';

/** Shared setup for spec 005 tests: venues, events, tiers, and orders through the real API. */

/**
 * A three-hour window starting `hour` hours after midnight UTC, `daysFromNow` days ahead. Always
 * relative to today, so events that take orders never drift into the past, where sales are closed
 * (spec 006 FR-014; research R2).
 */
export function windowAt(daysFromNow: number, hour = 18): { startsAt: string; endsAt: string } {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const start = new Date(midnight.getTime() + daysFromNow * 86_400_000 + hour * 3_600_000);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
  };
}

/**
 * A venue address the real address service matches (spec 013 research R1, R9). In tests the
 * fake geocoder saves it as `430 W VINE ST, LEXINGTON, KY 40507`.
 */
export const ADDRESS = { street: '430 W Vine St', city: 'Lexington', state: 'KY', zip: '40507' };

let day = 0;
/** A fresh, non-overlapping three-hour window for each event a test creates, a year ahead. */
function nextWindow(): { startsAt: string; endsAt: string } {
  day += 1;
  return windowAt(365 + day);
}

export async function venue(ctx: TestContext, name = 'Yum Center'): Promise<string> {
  const res = await asAdmin(ctx)
    .post('/locations')
    .send({ name, ...ADDRESS, seatingCapacity: 22090 })
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
    /** Spec 016: sent only when given, so other suites create events exactly as before. */
    maxTicketsPerCustomer?: number | null;
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
      ...(opts.maxTicketsPerCustomer !== undefined
        ? { maxTicketsPerCustomer: opts.maxTicketsPerCustomer }
        : {}),
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

/** Spec 015: a seat by its label, as a hold stores it. */
export interface HeldSeat {
  section: string;
  row: number;
  seat: number;
}

/**
 * Spec 015 (research R3, R16): a reservation and its live holds, inserted directly by SQL so a
 * test can place one in the past. `secondsAgo` moves `createdAt` back by the database's clock;
 * `expiresAt` is always 5 minutes after it (CHECK seat_reservation_five_minutes).
 */
export async function holdSeats(
  prisma: PrismaClient,
  opts: {
    eventId: string;
    customerSub: string;
    tierId?: string | null;
    seats: HeldSeat[];
    secondsAgo?: number;
  },
): Promise<{ reservationId: string; holdIds: string[] }> {
  const reservationId = randomUUID();
  const ago = opts.secondsAgo ?? 0;
  await prisma.$executeRaw`
    INSERT INTO "SeatReservation" ("id", "eventId", "customerSub", "tierId", "createdAt", "expiresAt")
    VALUES (${reservationId}::uuid, ${opts.eventId}::uuid, ${opts.customerSub},
            ${opts.tierId ?? null}::uuid, now() - make_interval(secs => ${ago}),
            now() - make_interval(secs => ${ago}) + interval '5 minutes')`;
  const holdIds: string[] = [];
  for (const s of opts.seats) {
    const id = randomUUID();
    holdIds.push(id);
    await prisma.$executeRaw`
      INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatSection", "seatRow",
                              "seatNumber", "createdAt")
      VALUES (${id}::uuid, ${reservationId}::uuid, ${opts.eventId}::uuid, ${s.section}, ${s.row},
              ${s.seat}, now() - make_interval(secs => ${ago}))`;
  }
  return { reservationId, holdIds };
}

/** Spec 015: ends one hold with a reason, `secondsAgo` before the database's now. */
export async function endHold(
  prisma: PrismaClient,
  holdId: string,
  reason: 'EXPIRED' | 'RELEASED' | 'LOGOUT' | 'BOUGHT' | 'CLOSED',
  secondsAgo = 0,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "SeatHold"
    SET "releasedAt" = now() - make_interval(secs => ${secondsAgo}),
        "endReason" = ${reason}::"SeatHoldEnd"
    WHERE "id" = ${holdId}::uuid`;
}
