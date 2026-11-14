import { randomUUID } from 'node:crypto';
import {
  LEVEL_COLORS,
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
 * drift into the past, where sales are closed (spec 034 FR-001: at the end). On a fall-back
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
 * past. Returns the event's id. Spec 025 (research R1): doors open `doorsBeforeStartSeconds`
 * before the start, 1 hour unless given, so every caller from before 025 keeps its entry window
 * (`[startsAt - 2 hours, endsAt)`).
 */
export async function eventAroundNow(
  ctx: TestContext,
  venueId: string,
  opts: {
    startsInSeconds: number;
    lastsSeconds: number;
    name?: string;
    capacity?: number;
    doorsBeforeStartSeconds?: number;
  },
): Promise<string> {
  const id = randomUUID();
  const doors = opts.startsInSeconds - (opts.doorsBeforeStartSeconds ?? 3600);
  await ctx.prisma.$executeRaw`
    INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt", "doorsOpenAt",
                         "totalTicketCapacity", "basePrice", "updatedAt")
    VALUES (${id}::uuid, ${opts.name ?? 'Around Now'}, ${venueId}::uuid,
            now() + make_interval(secs => ${opts.startsInSeconds}),
            now() + make_interval(secs => ${opts.startsInSeconds + opts.lastsSeconds}),
            now() + make_interval(secs => ${doors}),
            ${opts.capacity ?? 100}, 45.00, now())`;
  return id;
}

/**
 * Spec 034 (tasks T002): moves an event's whole window so that it ends at `end`, as if time had
 * passed: the start and doors move by the same amount, keeping the event's length and the doors'
 * gap (spec 025 research R1: the event_doors_open_range CHECK). `end` is the test's own instant,
 * sent as text so no session time zone is involved.
 */
export async function endEventAt(ctx: TestContext, eventId: string, end: Date): Promise<void> {
  const at = end.toISOString();
  await ctx.prisma.$executeRaw`
    UPDATE "Event"
    SET "doorsOpenAt" = "doorsOpenAt" + (${at}::timestamptz - "endsAt"),
        "startsAt" = "startsAt" + (${at}::timestamptz - "endsAt"),
        "endsAt" = ${at}::timestamptz
    WHERE "id" = ${eventId}::uuid`;
}

/**
 * Spec 017: an order and its tickets inserted directly, for what the API would no longer sell
 * (an event that ended) or no longer accepts (an order with no holder's name, as before 017).
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
        // Spec 038 FR-026: every ticket has its price.
        create: Array.from({ length: opts.quantity }, () => ({
          eventId,
          code: testTicketCode(),
          price: '45.00',
        })),
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
  /** Spec 038 (R10): the seat itself; a live hold needs one (CHECK seat_hold_live_has_seat). */
  seatId?: string;
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
                              "seatNumber", "seatId", "createdAt")
      VALUES (${id}::uuid, ${reservationId}::uuid, ${opts.eventId}::uuid, ${s.section}, ${s.row},
              ${s.seat}, ${s.seatId ?? null}::uuid, now() - make_interval(secs => ${ago}))`;
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

/** Spec 038 (T009a): a layout as `insertLayout` builds it. */
export interface LayoutSpec {
  name?: string;
  /** Level names, rank 1 first. */
  levels: string[];
  sections: {
    name: string;
    level: string;
    rows: number;
    seatsPerRow: number;
    /** A row's own level, by row number. */
    rowLevels?: Record<number, string>;
    /** A seat's own level, by `"<row>/<seat>"`. */
    seatLevels?: Record<string, string>;
  }[];
}

export interface InsertedLayout {
  id: string;
  /** Level ids by name. */
  levels: Record<string, string>;
  /** Section ids by name. */
  sections: Record<string, string>;
  /** A seat's id by section name, row number and seat number. */
  seat(section: string, row: number, seat: number): string;
}

/** Row `n`'s label: A, B, … Z, then AA, AB, … */
const rowLabel = (n: number): string =>
  n <= 26
    ? String.fromCharCode(64 + n)
    : rowLabel(Math.floor((n - 1) / 26)) + rowLabel(((n - 1) % 26) + 1);

/**
 * Spec 038 (T009a): a venue layout inserted directly, for responses that read layouts before the
 * layout routes exist (T017): levels in rank order, sections one beside the other, rows labelled
 * A, B, … and seats 1, 2, … Every row and seat takes its section's level unless given its own.
 */
export async function insertLayout(
  ctx: TestContext,
  venueId: string,
  spec: LayoutSpec,
): Promise<InsertedLayout> {
  const id = randomUUID();
  const width = spec.sections.reduce((w, s) => w + s.seatsPerRow * 2 + 12, 0);
  const height = Math.max(...spec.sections.map((s) => s.rows * 2 + 4));
  const seatCount = spec.sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0);
  await ctx.prisma.layout.create({
    data: {
      id,
      locationId: venueId,
      name: spec.name ?? 'Standard',
      source: 'LINES',
      floorKind: 'NONE',
      width,
      height,
      seatCount,
    },
  });
  const levels: Record<string, string> = {};
  for (const [i, name] of spec.levels.entries()) {
    levels[name] = randomUUID();
    await ctx.prisma.priceLevel.create({
      data: {
        id: levels[name],
        layoutId: id,
        name,
        rank: i + 1,
        color: LEVEL_COLORS[i % LEVEL_COLORS.length],
      },
    });
  }
  const sections: Record<string, string> = {};
  const seats = new Map<string, string>();
  let left = 0;
  for (const [position, s] of spec.sections.entries()) {
    const sectionId = randomUUID();
    sections[s.name] = sectionId;
    const w = s.seatsPerRow * 2 + 4;
    const h = s.rows * 2 + 4;
    await ctx.prisma.section.create({
      data: {
        id: sectionId,
        layoutId: id,
        name: s.name,
        levelId: levels[s.level],
        outline: [
          [left, 0],
          [left + w, 0],
          [left + w, h],
          [left, h],
        ],
        labelX: left + w / 2,
        labelY: h / 2,
        position,
      },
    });
    for (let row = 1; row <= s.rows; row++) {
      const rowLevel = s.rowLevels?.[row];
      const seatRow = await ctx.prisma.seatRow.create({
        data: {
          sectionId,
          number: row,
          label: rowLabel(row),
          levelId: rowLevel ? levels[rowLevel] : null,
        },
      });
      for (let seat = 1; seat <= s.seatsPerRow; seat++) {
        const seatLevel = s.seatLevels?.[`${row}/${seat}`];
        const created = await ctx.prisma.seat.create({
          data: {
            rowId: seatRow.id,
            sectionId,
            number: seat,
            label: String(seat),
            x: left + 2 * seat + 1,
            y: 2 * row + 1,
            levelId: seatLevel ? levels[seatLevel] : null,
          },
        });
        seats.set(`${s.name}/${row}/${seat}`, created.id);
      }
    }
    left += w + 8;
  }
  return {
    id,
    levels,
    sections,
    seat: (section, row, seat) => {
      const seatId = seats.get(`${section}/${row}/${seat}`);
      if (!seatId) throw new Error(`insertLayout: no seat ${section}/${row}/${seat}`);
      return seatId;
    },
  };
}

/**
 * Spec 038 (T010): the ids of a layout made through the API (`createVenueLayout`,
 * `importVenueLayout`), read from the database, in the shape `insertLayout` returns, so
 * `seatEventOn`, `sellSeats` and `holdSeats` work on it too. Seats by row and seat **numbers**.
 */
export async function layoutRefs(ctx: TestContext, layoutId: string): Promise<InsertedLayout> {
  const levels = await ctx.prisma.priceLevel.findMany({ where: { layoutId } });
  const sections = await ctx.prisma.section.findMany({ where: { layoutId } });
  const seats = await ctx.prisma.seat.findMany({
    where: { section: { layoutId } },
    include: { row: true, section: true },
  });
  const byPlace = new Map(
    seats.map((s) => [`${s.section.name}/${s.row.number}/${s.number}`, s.id] as const),
  );
  return {
    id: layoutId,
    levels: Object.fromEntries(levels.map((l) => [l.name, l.id])),
    sections: Object.fromEntries(sections.map((s) => [s.name, s.id])),
    seat: (section, row, seat) => {
      const seatId = byPlace.get(`${section}/${row}/${seat}`);
      if (!seatId) throw new Error(`layoutRefs: no seat ${section}/${row}/${seat}`);
      return seatId;
    },
  };
}

/**
 * Spec 038 (T009a): an event put on a layout directly, before the event's seating is saved through
 * the API (T023): its layout, a price per level (by name), and the given seats off sale. Each call
 * replaces the event's prices and off-sale seats.
 */
export async function seatEventOn(
  ctx: TestContext,
  eventId: string,
  layout: InsertedLayout,
  prices: Record<string, string>,
  offSale: string[] = [],
): Promise<void> {
  await ctx.prisma.event.update({
    where: { id: eventId },
    data: { layoutId: layout.id, reservedSeating: true },
  });
  await ctx.prisma.eventLevelPrice.deleteMany({ where: { eventId } });
  await ctx.prisma.eventOffSaleSeat.deleteMany({ where: { eventId } });
  await ctx.prisma.eventLevelPrice.createMany({
    data: Object.entries(prices).map(([name, price]) => ({
      eventId,
      levelId: layout.levels[name],
      price,
    })),
  });
  await ctx.prisma.eventOffSaleSeat.createMany({
    data: offSale.map((seatId) => ({ eventId, seatId })),
  });
}

/**
 * Spec 038 (T009a): a seated order inserted directly, one ticket per seat with its seat, labels,
 * level name and price as sold (FR-026), before seated orders sell them (T036). `unitPrice` is the
 * one price when every ticket has it, else `null` (R10).
 */
export async function sellSeats(
  ctx: TestContext,
  eventId: string,
  layout: InsertedLayout,
  seats: { section: string; row: number; seat: number; levelName: string; price: string }[],
  opts: { customer?: number; holderName?: string | null } = {},
): Promise<{ orderId: string; tickets: { id: string; code: string }[] }> {
  const n = opts.customer ?? 1;
  const total = seats.reduce((sum, s) => sum + Number(s.price), 0);
  const prices = new Set(seats.map((s) => s.price));
  const order = await ctx.prisma.order.create({
    data: {
      eventId,
      customerSub: subFor(`customer${n}`),
      customerUsername: `customer${n}`,
      quantity: seats.length,
      unitPrice: prices.size === 1 ? seats[0].price : null,
      totalPrice: total.toFixed(2),
      holderName: opts.holderName === undefined ? HOLDER : opts.holderName,
      tickets: {
        create: seats.map((s) => ({
          eventId,
          code: testTicketCode(),
          price: s.price,
          levelName: s.levelName,
          seatId: layout.seat(s.section, s.row, s.seat),
          seatSection: s.section,
          seatRow: s.row,
          seatNumber: s.seat,
          seatRowLabel: rowLabel(s.row),
          seatLabel: String(s.seat),
        })),
      },
    },
    include: { tickets: { orderBy: { code: 'asc' } } },
  });
  return { orderId: order.id, tickets: order.tickets.map((t) => ({ id: t.id, code: t.code })) };
}

/** Spec 038 (T027): a section of a layout made from section lines, at one level. */
export interface SeatedSection {
  name: string;
  rows: number;
  seatsPerRow: number;
  /** A level name; the first level when left out. */
  level?: string;
}

/** Spec 038 (T027): what `seatedEvent` makes. */
export interface SeatedEventSpec {
  /** The layout's sections, when no `layout` is given. */
  sections?: SeatedSection[];
  /**
   * The layout's levels in rank order, each with this event's price (`null`: no price, so its
   * seats must all be off sale). Default: one level "Standard" at 45.00.
   */
  levels?: { name: string; price: string | null }[];
  /** A layout already made (`seatedLayout`), to put another event on; its levels by name. */
  layout?: InsertedLayout;
  /** Seats off sale, by section name: a whole section, a row, or one seat. */
  offSale?: { section: string; row?: number; seat?: number }[];
  name?: string;
  maxTicketsPerCustomer?: number | null;
  startsAt?: string;
  endsAt?: string;
}

/** Spec 038 (T027): a seated event and its layout's ids. */
export interface SeatedEvent {
  eventId: string;
  layout: InsertedLayout;
}

const DEFAULT_LEVELS = [{ name: 'Standard', price: '45.00' }];
let seatedLayouts = 0;

/**
 * Spec 038 (T027): a layout made from section lines through the API (`createVenueLayout`), its
 * levels colored in `LEVEL_COLORS` order. Rows are labelled `1…n` and seats `1…m`, as lines label
 * them (research R6).
 */
export async function seatedLayout(
  ctx: TestContext,
  venueId: string,
  sections: SeatedSection[],
  levels: string[] = DEFAULT_LEVELS.map((l) => l.name),
  name?: string,
): Promise<InsertedLayout> {
  seatedLayouts += 1;
  const res = await asAdmin(ctx)
    .post(`/locations/${venueId}/layouts`)
    .send({
      name: name ?? `Seat plan ${seatedLayouts}`,
      levels: levels.map((l, i) => ({ name: l, color: LEVEL_COLORS[i % LEVEL_COLORS.length] })),
      sections: sections.map((s) => ({
        name: s.name,
        rows: s.rows,
        seatsPerRow: s.seatsPerRow,
        level: s.level ?? levels[0],
      })),
    })
    .expect(201);
  return layoutRefs(ctx, res.body.id);
}

/**
 * Spec 038 (T027; research R8): a seated event scheduled through the API, as an admin does it: on
 * a layout made from section lines (or one given), a price for each priced level, and the given
 * seats off sale. Every test of holds, orders and the stream starts from it.
 */
export async function seatedEvent(
  ctx: TestContext,
  venueId: string,
  spec: SeatedEventSpec,
): Promise<SeatedEvent> {
  const levels = spec.levels ?? DEFAULT_LEVELS;
  const layout =
    spec.layout ??
    (await seatedLayout(
      ctx,
      venueId,
      spec.sections ?? [],
      levels.map((l) => l.name),
    ));
  const window = spec.startsAt && spec.endsAt ? spec : nextWindow();
  const res = await asAdmin(ctx)
    .post('/events')
    .send({
      name: spec.name ?? 'Season Opener',
      locationId: venueId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      basePrice: '0.00',
      layoutId: layout.id,
      levelPrices: levels
        .filter((l) => l.price !== null)
        .map((l) => ({ levelId: layout.levels[l.name], price: l.price })),
      offSale: (spec.offSale ?? []).map((o) => ({
        sectionId: layout.sections[o.section],
        ...(o.row !== undefined ? { row: o.row } : {}),
        ...(o.seat !== undefined ? { seat: o.seat } : {}),
      })),
      ...(spec.maxTicketsPerCustomer !== undefined
        ? { maxTicketsPerCustomer: spec.maxTicketsPerCustomer }
        : {}),
    });
  if (res.status !== 201) {
    throw new Error(`seatedEvent: createEvent answered ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { eventId: res.body.id, layout };
}
