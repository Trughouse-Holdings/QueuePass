import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  EventSeating,
  LevelColor,
  LevelPriceInput,
  OffSaleSelector,
  SeatStateChange,
} from '@queuepass/shared';
import { conflict } from '../common/conflict';
import type { PrismaService } from '../prisma/prisma.service';
import { SEAT_LEVEL_SQL } from './seat-levels';

/**
 * Spec 038 US2 (FR-010–FR-015; research R8, R9, R12): an event's seating, saved with the event in
 * `createEvent` and `updateEvent`, inside the event's transaction, all or nothing. The caller has
 * locked the venue (`lockVenueShared`) and, on an update, the event, in that order (R7); this file
 * only reads the layout, whose rows the event's foreign key then holds with `KEY SHARE`. It never
 * locks a layout.
 *
 * The checks, in order (as `031` orders an event's checks): the fields (`tiers`,
 * `totalTicketCapacity`, `levelPrices` and `offSale` without a layout), the layout (of the venue;
 * not changed while the event has sold or held seats), the prices (levels of the layout, each
 * once), the seats off sale (each selector names a seat), every level with seats on sale priced,
 * a seat on sale, no sold or held seat taken off sale. The capacity and the `016` limit come
 * after, in `events.service.ts`, against the seats on sale.
 */

type Tx = Prisma.TransactionClient;
/** The service's own client or a transaction's. */
type Db = PrismaService | Tx;

/** Off-sale rows are written in batches of this many (a layout has up to 30,000 seats). */
const BATCH = 5_000;

/** The seating fields of `EventInput` and `EventUpdate`. */
export interface SeatingRequest {
  layoutId?: string | null;
  levelPrices?: LevelPriceInput[];
  offSale?: OffSaleSelector[];
}

/** One seat of a layout with what the seating save needs of it. */
interface LayoutSeat {
  id: string;
  sectionId: string;
  section: string;
  row: number;
  seat: number;
  levelId: string;
}

interface LayoutLevel {
  id: string;
  name: string;
  rank: number;
  color: LevelColor;
}

/** A layout's levels by rank and seats by section position, row and seat number. */
interface SeatingLayout {
  id: string;
  levels: LayoutLevel[];
  sections: { id: string; name: string }[];
  seats: LayoutSeat[];
}

/** What the event's seating will be once saved. */
export interface SeatingPlan {
  layoutId: string;
  /** The event had another layout (or none) before this save. */
  layoutChanged: boolean;
  prices: Map<string, Prisma.Decimal>;
  /** The prices differ from those saved (always on a new layout). */
  pricesChanged: boolean;
  offSale: Set<string>;
  /** Seats newly off sale and put back on sale, on the same layout. */
  added: LayoutSeat[];
  removed: LayoutSeat[];
  /** `totalTicketCapacity`, R9. */
  seatsOnSale: number;
  /** `basePrice`, R9: the lowest price of a level with seats on sale. */
  basePrice: Prisma.Decimal;
}

/** What the event has saved before this request; `null` on a schedule. */
export interface SavedSeating {
  eventId: string;
  eventName: string;
  layoutId: string | null;
}

/** `400 VALIDATION_FAILED` about one seating field (contract: `details.field`, `details.fields`). */
export function seatingRefusal(
  field: string,
  entry: string,
  message: string,
  details: Record<string, unknown> = {},
): HttpException {
  return new HttpException(
    {
      error: {
        code: 'VALIDATION_FAILED',
        message,
        details: { field, fields: [`${field} ${entry}`], ...details },
      },
    },
    HttpStatus.BAD_REQUEST,
  );
}

const listed = (names: string[]): string =>
  names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * R8, FR-010: the layout the event has after the request. `layoutId` sent decides; else a move to
 * another venue clears it (its layout is of the old venue); else it is kept.
 */
export function targetLayout(
  saved: { layoutId: string | null; locationId: string } | null,
  request: SeatingRequest,
  locationId: string,
): string | null {
  if (request.layoutId !== undefined) return request.layoutId;
  if (!saved) return null;
  return saved.locationId === locationId ? saved.layoutId : null;
}

/**
 * The field rules before any read (contract `EventInput.layoutId`): with a layout, no ticket types
 * and no typed capacity; without one, no prices or seats off sale.
 */
export function assertSeatingFields(
  layoutId: string | null,
  request: SeatingRequest & { tiers?: unknown[]; totalTicketCapacity?: number },
): void {
  if (layoutId !== null) {
    if ((request.tiers ?? []).length > 0) {
      throw seatingRefusal(
        'tiers',
        'must be empty for reserved seating: a seated event has no ticket types',
        'A seated event has no ticket types; its prices are set per price level.',
      );
    }
    if (request.totalTicketCapacity !== undefined) {
      throw seatingRefusal(
        'totalTicketCapacity',
        'is set by the seats on sale while the event has a layout',
        "A seated event's ticket capacity is its seats on sale; it can't be typed.",
      );
    }
    return;
  }
  for (const field of ['levelPrices', 'offSale'] as const) {
    if (request[field] !== undefined) {
      throw seatingRefusal(
        field,
        'needs a layout: a general-admission event has no price levels or seats',
        'A general-admission event has no price levels or seats; choose a layout first.',
      );
    }
  }
}

/** Items by key, each list in the items' order, the keys in order of first appearance. */
function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const list = groups.get(key(item));
    if (list) list.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/** A layout of the venue, with its levels and seats; `400 layoutId` otherwise. */
async function readLayout(db: Db, layoutId: string, locationId: string): Promise<SeatingLayout> {
  const found = await db.$queryRaw<{ locationId: string }[]>`
    SELECT "locationId"::text AS "locationId" FROM "Layout" WHERE "id" = ${layoutId}::uuid`;
  if (found.length === 0 || found[0].locationId !== locationId) {
    throw seatingRefusal(
      'layoutId',
      "must be one of the venue's layouts",
      found.length === 0
        ? 'That layout no longer exists. Choose another.'
        : "That layout belongs to another venue. Choose one of this event's venue's layouts.",
    );
  }
  return readLayoutContent(db, layoutId);
}

async function readLayoutContent(db: Db, layoutId: string): Promise<SeatingLayout> {
  const levels = await db.$queryRaw<LayoutLevel[]>`
    SELECT "id"::text AS "id", "name", "rank", "color"
    FROM "PriceLevel" WHERE "layoutId" = ${layoutId}::uuid ORDER BY "rank"`;
  const sections = await db.$queryRaw<{ id: string; name: string }[]>`
    SELECT "id"::text AS "id", "name" FROM "Section"
    WHERE "layoutId" = ${layoutId}::uuid ORDER BY "position"`;
  const seats = await db.$queryRaw<LayoutSeat[]>`
    SELECT s."id"::text AS "id", sec."id"::text AS "sectionId", sec."name" AS "section",
           r."number" AS "row", s."number" AS "seat", ${SEAT_LEVEL_SQL}::text AS "levelId"
    FROM "Section" sec
    JOIN "Seat" s ON s."sectionId" = sec."id"
    JOIN "SeatRow" r ON r."id" = s."rowId"
    WHERE sec."layoutId" = ${layoutId}::uuid
    ORDER BY sec."position", r."number", s."number"`;
  return { id: layoutId, levels, sections, seats };
}

/** R8: each price a level of the layout, each level once. */
function checkPrices(layout: SeatingLayout, sent: LevelPriceInput[]): Map<string, Prisma.Decimal> {
  const ids = new Set(layout.levels.map((l) => l.id));
  const prices = new Map<string, Prisma.Decimal>();
  for (const [i, p] of sent.entries()) {
    if (!ids.has(p.levelId)) {
      throw seatingRefusal(
        'levelPrices',
        `${i}.levelId is not a price level of this layout`,
        'A price is for a level of another layout. Reload the price table and try again.',
        { index: i },
      );
    }
    if (prices.has(p.levelId)) {
      const name = layout.levels.find((l) => l.id === p.levelId)?.name ?? '';
      throw seatingRefusal(
        'levelPrices',
        `${i}.levelId lists a level already priced in this request`,
        `${name} is priced twice. Give each level one price.`,
        { index: i },
      );
    }
    prices.set(p.levelId, new Prisma.Decimal(p.price));
  }
  return prices;
}

/** R8: the seats the selectors name; a selector that names no seat of the layout is `400`. */
function expandOffSale(layout: SeatingLayout, selectors: OffSaleSelector[]): Set<string> {
  const bySection = groupBy(layout.seats, (s) => s.sectionId);
  const names = new Map(layout.sections.map((s) => [s.id, s.name]));
  const off = new Set<string>();
  for (const [i, sel] of selectors.entries()) {
    const seats = (bySection.get(sel.sectionId) ?? []).filter(
      (s) =>
        (sel.row === undefined || s.row === sel.row) &&
        (sel.seat === undefined || s.seat === sel.seat),
    );
    if (seats.length === 0) {
      const section = names.get(sel.sectionId);
      const place = !section
        ? 'a section that is not in this layout'
        : sel.seat !== undefined
          ? `Section ${section}, row ${sel.row}, seat ${sel.seat}, which does not exist`
          : `Section ${section}, row ${sel.row}, which does not exist`;
      throw seatingRefusal(
        'offSale',
        `${i} names no seat of this layout`,
        `The seats off sale name ${place}. Reload the map and try again.`,
        { index: i },
      );
    }
    for (const s of seats) off.add(s.id);
  }
  return off;
}

/** Valid tickets and live holds of the event (R10: a hold not yet released counts). */
async function soldAndHeld(
  db: Db,
  eventId: string,
  seatIds: string[],
): Promise<{ sold: Set<string>; held: Set<string> }> {
  if (seatIds.length === 0) return { sold: new Set(), held: new Set() };
  const rows = await db.$queryRaw<{ seatId: string; kind: 'sold' | 'held' }[]>`
    SELECT t."seatId"::text AS "seatId", 'sold' AS "kind" FROM "Ticket" t
    WHERE t."eventId" = ${eventId}::uuid AND t."status" = 'VALID'
      AND t."seatId" = ANY(${seatIds}::uuid[])
    UNION ALL
    SELECT h."seatId"::text, 'held' FROM "SeatHold" h
    WHERE h."eventId" = ${eventId}::uuid AND h."releasedAt" IS NULL
      AND h."seatId" = ANY(${seatIds}::uuid[])`;
  return {
    sold: new Set(rows.filter((r) => r.kind === 'sold').map((r) => r.seatId)),
    held: new Set(rows.filter((r) => r.kind === 'held').map((r) => r.seatId)),
  };
}

/**
 * FR-010, R8: the event's sold seats and live holds, which keep its layout (`409
 * EVENT_HAS_ORDERS`, `details.field: layoutId`).
 */
export async function assertLayoutFree(db: Db, eventId: string, eventName: string): Promise<void> {
  const [{ sold, held }] = await db.$queryRaw<{ sold: number; held: number }[]>`
    SELECT (SELECT count(*)::int FROM "Ticket"
            WHERE "eventId" = ${eventId}::uuid AND "status" = 'VALID') AS "sold",
           (SELECT count(*)::int FROM "SeatHold"
            WHERE "eventId" = ${eventId}::uuid AND "releasedAt" IS NULL) AS "held"`;
  if (sold + held === 0) return;
  throw conflict(
    'EVENT_HAS_ORDERS',
    `${eventName} has sold or held seats, so its layout can no longer change.`,
    { field: 'layoutId', ticketsSold: sold, seatsHeld: held },
  );
}

/**
 * R8, R9: checks and plans the seating a request gives an event on `layoutId` (of the venue at
 * `locationId`). `saved` is the event as stored (`null` on a schedule). Fields left out keep what
 * is saved on the same layout; a new layout starts with no prices and no seats off sale.
 */
export async function planSeating(
  db: Db,
  args: {
    layoutId: string;
    locationId: string;
    request: SeatingRequest;
    saved: SavedSeating | null;
  },
): Promise<SeatingPlan> {
  const { layoutId, request, saved } = args;
  const layoutChanged = saved === null || saved.layoutId !== layoutId;
  const layout = await readLayout(db, layoutId, args.locationId);

  const savedPrices = layoutChanged
    ? new Map<string, Prisma.Decimal>()
    : new Map(
        (await db.eventLevelPrice.findMany({ where: { eventId: saved.eventId } })).map((p) => [
          p.levelId,
          p.price,
        ]),
      );
  const savedOff = layoutChanged
    ? new Set<string>()
    : new Set(
        (await db.eventOffSaleSeat.findMany({ where: { eventId: saved.eventId } })).map(
          (o) => o.seatId,
        ),
      );

  const prices = request.levelPrices ? checkPrices(layout, request.levelPrices) : savedPrices;
  const offSale = request.offSale ? expandOffSale(layout, request.offSale) : savedOff;

  // FR-011: every level with a seat on sale has a price; FR-014: a seat on sale.
  const onSale = new Map<string, number>();
  for (const s of layout.seats) {
    if (!offSale.has(s.id)) onSale.set(s.levelId, (onSale.get(s.levelId) ?? 0) + 1);
  }
  const unpriced = layout.levels.filter((l) => onSale.has(l.id) && !prices.has(l.id));
  if (unpriced.length > 0) {
    const names = unpriced.map((l) => l.name);
    throw seatingRefusal(
      'levelPrices',
      `needs a price for ${listed(names)}, which ${names.length === 1 ? 'has' : 'have'} seats on sale`,
      `Give ${listed(names)} a price: ${names.length === 1 ? 'it has' : 'they have'} seats on sale.`,
      { levels: unpriced.map((l) => ({ levelId: l.id, name: l.name })) },
    );
  }
  const seatsOnSale = layout.seats.length - offSale.size;
  if (seatsOnSale === 0) {
    throw seatingRefusal(
      'offSale',
      'leaves no seat on sale',
      'Every seat is off sale, so this event would sell nothing. Put some seats on sale.',
    );
  }

  // FR-013: a sold or held seat is never taken off sale.
  const added = layout.seats.filter((s) => offSale.has(s.id) && !savedOff.has(s.id));
  const removed = layout.seats.filter((s) => savedOff.has(s.id) && !offSale.has(s.id));
  if (saved !== null && added.length > 0) {
    const { sold, held } = await soldAndHeld(
      db,
      saved.eventId,
      added.map((s) => s.id),
    );
    const taken = added.filter((s) => sold.has(s.id) || held.has(s.id));
    if (taken.length > 0) {
      const label = (s: LayoutSeat) => ({ section: s.section, row: s.row, seat: s.seat });
      const text = taken.map((s) => `Section ${s.section}, Row ${s.row}, Seat ${s.seat}`);
      throw conflict(
        'SEAT_TAKEN',
        `${listed(text)} ${taken.length === 1 ? 'is' : 'are'} sold or held, so ` +
          `${taken.length === 1 ? 'it' : 'they'} can't be taken off sale.`,
        {
          field: 'offSale',
          seats: taken.map(label),
          ...(taken.some((s) => held.has(s.id))
            ? { reserved: taken.filter((s) => held.has(s.id)).map(label) }
            : {}),
        },
      );
    }
  }

  const levelPrices = [...onSale.keys()].map((id) => prices.get(id) as Prisma.Decimal);
  const basePrice = levelPrices.reduce((a, b) => (b.lessThan(a) ? b : a));
  const pricesChanged =
    layoutChanged ||
    prices.size !== savedPrices.size ||
    [...prices].some(([id, p]) => !savedPrices.get(id)?.equals(p));

  return {
    layoutId,
    layoutChanged,
    prices,
    pricesChanged,
    offSale,
    added: layoutChanged ? [] : added,
    removed: layoutChanged ? [] : removed,
    seatsOnSale,
    basePrice,
  };
}

/** Removes an event's prices and seats off sale (its layout changed or went). */
export async function clearSeating(tx: Tx, eventId: string): Promise<void> {
  await tx.eventLevelPrice.deleteMany({ where: { eventId } });
  await tx.eventOffSaleSeat.deleteMany({ where: { eventId } });
}

/**
 * Writes a planned seating after the event row (its `layoutId`, `reservedSeating`, capacity and
 * base price are the caller's). R12: an off-sale change on the same layout increments the event's
 * `seatSeq` once, here, under the event lock, and returns the seat changes to publish with it after
 * the commit; a new layout's seats are not published (its viewers' streams end).
 */
export async function writeSeating(
  tx: Tx,
  eventId: string,
  plan: SeatingPlan,
): Promise<{ changes: SeatStateChange[]; seq: number | null }> {
  if (plan.layoutChanged) await clearSeating(tx, eventId);
  if (plan.pricesChanged) {
    await tx.eventLevelPrice.deleteMany({ where: { eventId } });
    await tx.eventLevelPrice.createMany({
      data: [...plan.prices].map(([levelId, price]) => ({ eventId, levelId, price })),
    });
  }
  const insert = plan.layoutChanged ? [...plan.offSale] : plan.added.map((s) => s.id);
  for (let i = 0; i < insert.length; i += BATCH) {
    await tx.eventOffSaleSeat.createMany({
      data: insert.slice(i, i + BATCH).map((seatId) => ({ eventId, seatId })),
    });
  }
  if (plan.removed.length > 0) {
    await tx.eventOffSaleSeat.deleteMany({
      where: { eventId, seatId: { in: plan.removed.map((s) => s.id) } },
    });
  }
  if (plan.added.length + plan.removed.length === 0) return { changes: [], seq: null };

  const [{ seq }] = await tx.$queryRaw<{ seq: bigint }[]>`
    UPDATE "Event" SET "seatSeq" = "seatSeq" + 1 WHERE "id" = ${eventId}::uuid
    RETURNING "seatSeq" AS "seq"`;
  const change =
    (state: 'offSale' | 'open', from: 'open' | 'offSale') =>
    (s: LayoutSeat): SeatStateChange => ({
      sectionId: s.sectionId,
      row: s.row,
      seat: s.seat,
      state,
      from,
      levelId: s.levelId,
    });
  return {
    changes: [
      ...plan.added.map(change('offSale', 'open')),
      ...plan.removed.map(change('open', 'offSale')),
    ],
    seq: Number(seq),
  };
}

/**
 * R8: an event's seats off sale as selectors, compacted: every whole section as `{sectionId}`,
 * then every whole row as `{sectionId, row}`, then single seats, each in section, row and seat
 * order. The Admin app's off-sale tool compacts the same way.
 */
function compact(layout: SeatingLayout, off: Set<string>): OffSaleSelector[] {
  const sections: OffSaleSelector[] = [];
  const rows: OffSaleSelector[] = [];
  const seats: OffSaleSelector[] = [];
  const grouped = groupBy(layout.seats, (s) => s.sectionId);
  for (const section of layout.sections) {
    const inSection = grouped.get(section.id) ?? [];
    if (inSection.length > 0 && inSection.every((s) => off.has(s.id))) {
      sections.push({ sectionId: section.id });
      continue;
    }
    for (const [row, list] of groupBy(inSection, (s) => s.row)) {
      if (list.every((s) => off.has(s.id))) rows.push({ sectionId: section.id, row });
      else {
        for (const s of list) {
          if (off.has(s.id)) seats.push({ sectionId: section.id, row, seat: s.seat });
        }
      }
    }
  }
  return [...sections, ...rows, ...seats];
}

/** `getEventSeating` (R8): the event's layout, levels with prices, and seats off sale. */
export async function readEventSeating(db: Db, eventId: string): Promise<EventSeating> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { layoutId: true } });
  if (!event) throw new NotFoundException(`No event exists with id ${eventId}.`);
  if (event.layoutId === null) {
    return { eventId, layoutId: null, levels: [], offSale: [], seatsOnSale: 0, seatsOffSale: 0 };
  }
  const layout = await readLayoutContent(db, event.layoutId);
  const prices = new Map(
    (await db.eventLevelPrice.findMany({ where: { eventId } })).map((p) => [
      p.levelId,
      p.price.toFixed(2),
    ]),
  );
  const off = new Set(
    (await db.eventOffSaleSeat.findMany({ where: { eventId } })).map((o) => o.seatId),
  );
  const byLevel = groupBy(layout.seats, (s) => s.levelId);
  const levels = layout.levels.map((l) => {
    const seats = byLevel.get(l.id) ?? [];
    return {
      levelId: l.id,
      name: l.name,
      rank: l.rank,
      color: l.color,
      seatCount: seats.length,
      seatsOnSale: seats.filter((s) => !off.has(s.id)).length,
      price: prices.get(l.id) ?? null,
    };
  });
  const seatsOffSale = layout.seats.filter((s) => off.has(s.id)).length;
  return {
    eventId,
    layoutId: layout.id,
    levels,
    offSale: compact(layout, off),
    seatsOnSale: layout.seats.length - seatsOffSale,
    seatsOffSale,
  };
}
