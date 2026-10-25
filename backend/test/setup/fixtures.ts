import { randomUUID } from 'node:crypto';
import {
  liveCode,
  localDate,
  resolveLocal,
  toOffsetDateTime,
  type UsTimeZone,
} from '@queuepass/shared';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { as, asAdmin } from './authed-request';
import type { TestContext } from './test-app';
import { subFor, tokenFor } from './tokens';

/** Shared setup for spec 005 tests: venues, events, tiers, and orders through the real API. */

/**
 * A three-hour window starting at the venue's local `hour`:00, `daysFromNow` days after today at
 * the venue, stated in the venue's offset (spec 020 research R9, R20): the Backend refuses an
 * event time in any other offset. Always relative to today, so events that take orders never
 * drift into the past, where sales are closed (spec 006 FR-014; research R2). On a fall-back
 * night the first of a repeated hour is taken; on a spring-forward night, the next hour.
 */
export function windowAt(
  daysFromNow: number,
  hour = 18,
  zone: UsTimeZone = 'America/New_York',
): { startsAt: string; endsAt: string } {
  const [y, m, d] = localDate(new Date(), zone).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + daysFromNow)).toISOString().slice(0, 10);
  const at = (h: number): Date | null => {
    const r = resolveLocal(`${day}T${String(h).padStart(2, '0')}:00`, zone);
    return r.kind === 'ok' ? r.moment.instant : r.kind === 'repeated' ? r.first.instant : null;
  };
  const start = at(hour) ?? (at(hour + 1) as Date);
  return {
    startsAt: toOffsetDateTime(start, zone),
    endsAt: toOffsetDateTime(new Date(start.getTime() + 3 * 3_600_000), zone),
  };
}

/**
 * Spec 020 (research R20): a computed instant ("now + 2 hours", for sales close and entry
 * windows) stated in the venue's offset, as the Backend requires of an event time.
 */
export function atInstant(date: Date | number, zone: UsTimeZone = 'America/New_York'): string {
  return toOffsetDateTime(date, zone);
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

/** Spec 017: requests as a gate agent (`agent1` to `agent30`, spec 001). */
export async function agent(ctx: TestContext, n = 1) {
  return as(ctx, await tokenFor({ username: `agent${n}`, roles: ['gate-agent'] }));
}

/**
 * Spec 017: the holder's name every test order carries once orders require one (FR-001). Sent by
 * `reserveThenOrder` and by every body posted to `/events/{id}/orders` from T031 on, never
 * before: until the order DTO accepts the field, the ValidationPipe refuses it.
 */
export const HOLDER = 'Test Holder';

/**
 * Spec 017 (research R5): an event placed relative to the DATABASE's `now()`, inserted directly
 * with `ctx.prisma`, so a test can put it in the past or inside the entry window, which the API's
 * own rules (scheduling buffer, sales-closed) would refuse. Negative `startsInSeconds` is the
 * past. Returns the event's id.
 */
export async function eventAroundNow(
  ctx: TestContext,
  venueId: string,
  opts: { startsInSeconds: number; lastsSeconds: number; name?: string; capacity?: number },
): Promise<string> {
  const id = randomUUID();
  await ctx.prisma.$executeRaw`
    INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt", "totalTicketCapacity",
                         "basePrice", "updatedAt")
    VALUES (${id}::uuid, ${opts.name ?? 'Around Now'}, ${venueId}::uuid,
            now() + make_interval(secs => ${opts.startsInSeconds}),
            now() + make_interval(secs => ${opts.startsInSeconds + opts.lastsSeconds}),
            ${opts.capacity ?? 100}, 45.00, now())`;
  return id;
}

/**
 * Spec 017: an order and its tickets inserted directly, for what the API would no longer sell
 * (an event that started) or no longer accepts (an order with no holder's name, as before 017).
 */
export async function orderWithTickets(
  ctx: TestContext,
  eventId: string,
  opts: { quantity: number; holderName?: string | null; customer?: number } = { quantity: 1 },
): Promise<{ orderId: string; tickets: { id: string; code: string }[] }> {
  const n = opts.customer ?? 1;
  const order = await ctx.prisma.order.create({
    data: {
      eventId,
      customerSub: subFor(`customer${n}`),
      customerUsername: `customer${n}`,
      quantity: opts.quantity,
      unitPrice: '45.00',
      totalPrice: (45 * opts.quantity).toFixed(2),
      holderName: opts.holderName ?? null,
      tickets: {
        create: Array.from({ length: opts.quantity }, () => ({ eventId, code: testTicketCode() })),
      },
    },
    include: { tickets: { orderBy: { code: 'asc' } } },
  });
  return { orderId: order.id, tickets: order.tickets.map((t) => ({ id: t.id, code: t.code })) };
}

/** Codes from the ticket alphabet (no I, O, 0, or 1), unique per run. */
let codeCounter = 0;
function testTicketCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  codeCounter += 1;
  let suffix = '';
  let left = codeCounter;
  for (let i = 0; i < 6; i++) {
    suffix = alphabet[left % alphabet.length] + suffix;
    left = Math.floor(left / alphabet.length);
  }
  return `GATEFX${suffix}`;
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
  prisma: PrismaService,
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
  prisma: PrismaService,
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

/**
 * Spec 015 (FR-006, spec Assumptions): a seated order now needs the customer's own reservation, so
 * seated-order tests reserve the seats first and then order them, and otherwise check the same
 * things. Returns the order response, whatever its status.
 */
export async function reserveThenOrder(
  ctx: TestContext,
  token: string,
  eventId: string,
  body: {
    tierId?: string;
    seats: { sectionId: string; row: number; seat: number }[];
    requestId?: string;
  },
) {
  const client = as(ctx, token);
  const reserved = await client.post(`/events/${eventId}/reservation`).send({ seats: body.seats });
  if (reserved.status !== 200 && reserved.status !== 201) {
    throw new Error(
      `reserveThenOrder: reserving failed with ${reserved.status} ${JSON.stringify(reserved.body)}`,
    );
  }
  return client.post(`/events/${eventId}/orders`).send({
    // Spec 017 FR-001 (T031): every order carries the test holder's name.
    holderName: HOLDER,
    ...(body.tierId ? { tierId: body.tierId } : {}),
    quantity: body.seats.length,
    seats: body.seats,
    ...(body.requestId ? { requestId: body.requestId } : {}),
  });
}

/**
 * Spec 018: the live code of a ticket for a window, made from its secret (read with the one
 * `select` that names it) by the shared module, exactly as the Customer app makes it.
 */
export async function liveCodeFor(
  ctx: TestContext,
  ticketId: string,
  window: number,
): Promise<string> {
  const { entrySecret } = await ctx.prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { entrySecret: true },
  });
  return liveCode(entrySecret, ticketId, window);
}
