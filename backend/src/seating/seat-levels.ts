import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Spec 038 FR-003, research R1: a seat's level is its own, else its row's, else its section's. The
 * level is never stored twice; every query that needs it computes it with this fragment, over the
 * aliases `s` (Seat), `r` (SeatRow) and `sec` (Section).
 */
export const SEAT_LEVEL_SQL = Prisma.sql`COALESCE(s."levelId", r."levelId", sec."levelId")`;

/** The same rule in TypeScript, for levels already read. */
export function resolveSeatLevel(levels: {
  seat: string | null;
  row: string | null;
  section: string;
}): string {
  return levels.seat ?? levels.row ?? levels.section;
}

/** Spec 038 research R11: one section's seats of one level, for one event, by state. */
export interface SectionLevelCounts {
  sectionId: string;
  levelId: string;
  open: number;
  reserved: number;
  sold: number;
  offSale: number;
}

/**
 * Spec 038 data-model.md "States", research R11, R12: a seat's state for one event, over the
 * aliases `e` (Event), `s` (Seat), `o` (its EventOffSaleSeat), `t` (its VALID ticket) and `h` (its
 * live hold), in this order: `offSale`, `sold`, `reserved`, else `open`.
 *
 * A hold counts while its row is live (`releasedAt` NULL), not by the reservation's clock: a
 * reservation that ran out is ended, and its seats published as open with the next `seq`, by the
 * first locked path or the sweep (spec 015 research R3, R4). Counted open before that, the seat
 * would be open in a map read at an earlier `seq` and then opened again by that change, counted
 * twice (FR-023). Under the event lock, where `closeRunOut` runs first, the two agree.
 */
const SEAT_STATE_SQL = Prisma.sql`
  CASE WHEN o."seatId" IS NOT NULL THEN 'offSale'
       WHEN t."id" IS NOT NULL THEN 'sold'
       WHEN h."id" IS NOT NULL THEN 'reserved'
       ELSE 'open' END`;

/** The joins `SEAT_STATE_SQL` reads, for the event `e` and the seat `s`. */
const SEAT_STATE_JOINS = Prisma.sql`
  LEFT JOIN "EventOffSaleSeat" o ON o."eventId" = e."id" AND o."seatId" = s."id"
  LEFT JOIN "Ticket" t ON t."eventId" = e."id" AND t."seatId" = s."id" AND t."status" = 'VALID'
  LEFT JOIN "SeatHold" h ON h."eventId" = e."id" AND h."seatId" = s."id" AND h."releasedAt" IS NULL`;

/**
 * Spec 038 research R11, R12: every seat of an event's layout counted per section and resolved
 * level by its state for that event (`SEAT_STATE_SQL`), in one grouped statement, with the event's
 * `seatSeq` read in that same statement (so a change is either in the counts or has a greater
 * `seq`, never both). Rows are in section position, then level rank order. A general-admission
 * event has none; no event is a 404.
 */
export async function countSeatStates(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  eventId: string,
): Promise<{ seq: bigint; counts: SectionLevelCounts[] }> {
  const rows = await db.$queryRaw<
    ({ seq: bigint } & {
      [K in keyof SectionLevelCounts]: SectionLevelCounts[K] | null;
    })[]
  >`
    WITH e AS (SELECT "id", "layoutId", "seatSeq" FROM "Event" WHERE "id" = ${eventId}::uuid),
    states AS (
      SELECT sec."id" AS "sectionId", sec."position", ${SEAT_LEVEL_SQL} AS "levelId",
             ${SEAT_STATE_SQL} AS state
      FROM e
      JOIN "Section" sec ON sec."layoutId" = e."layoutId"
      JOIN "Seat" s ON s."sectionId" = sec."id"
      JOIN "SeatRow" r ON r."id" = s."rowId"
      ${SEAT_STATE_JOINS}
    ),
    grouped AS (
      SELECT st."sectionId", st."levelId", min(st."position") AS "position",
             count(*) FILTER (WHERE st.state = 'open')::int AS "open",
             count(*) FILTER (WHERE st.state = 'reserved')::int AS "reserved",
             count(*) FILTER (WHERE st.state = 'sold')::int AS "sold",
             count(*) FILTER (WHERE st.state = 'offSale')::int AS "offSale"
      FROM states st
      GROUP BY st."sectionId", st."levelId"
    )
    SELECT e."seatSeq" AS seq, g."sectionId"::text AS "sectionId", g."levelId"::text AS "levelId",
           g."open", g."reserved", g."sold", g."offSale"
    FROM e
    LEFT JOIN grouped g ON true
    LEFT JOIN "PriceLevel" pl ON pl."id" = g."levelId"
    ORDER BY g."position", pl."rank"`;
  if (rows.length === 0) throw new NotFoundException(`No event exists with id ${eventId}.`);
  const counts = rows
    .filter((r) => r.sectionId !== null)
    .map((r) => ({
      sectionId: r.sectionId as string,
      levelId: r.levelId as string,
      open: r.open as number,
      reserved: r.reserved as number,
      sold: r.sold as number,
      offSale: r.offSale as number,
    }));
  return { seq: rows[0].seq, counts };
}

/** Spec 038 research R11: one seat of a section with its state for one event. */
export interface SectionSeatState {
  row: number;
  rowLabel: string;
  seat: number;
  label: string;
  x: number;
  y: number;
  levelId: string;
  accessible: boolean;
  state: 'open' | 'reserved' | 'sold' | 'offSale';
}

/**
 * Spec 038 research R11, R12: one section's seats, rows front first, each with its resolved level
 * and its state for the event (`SEAT_STATE_SQL`), and the event's `seatSeq` read in the same
 * statement. The caller checks that the section is of the event's layout.
 */
export async function sectionSeatStates(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  eventId: string,
  sectionId: string,
): Promise<{ seq: bigint; seats: SectionSeatState[] }> {
  const rows = await db.$queryRaw<
    ({ seq: bigint } & { [K in keyof SectionSeatState]: SectionSeatState[K] | null })[]
  >`
    WITH e AS (SELECT "id", "seatSeq" FROM "Event" WHERE "id" = ${eventId}::uuid)
    SELECT e."seatSeq" AS seq, r."number" AS "row", r."label" AS "rowLabel", s."number" AS "seat",
           s."label", s."x", s."y", ${SEAT_LEVEL_SQL}::text AS "levelId", s."accessible",
           ${SEAT_STATE_SQL} AS state
    FROM e
    LEFT JOIN "Section" sec ON sec."id" = ${sectionId}::uuid
    LEFT JOIN "SeatRow" r ON r."sectionId" = sec."id"
    LEFT JOIN "Seat" s ON s."rowId" = r."id"
    ${SEAT_STATE_JOINS}
    ORDER BY r."number", s."number"`;
  if (rows.length === 0) throw new NotFoundException(`No event exists with id ${eventId}.`);
  return {
    seq: rows[0].seq,
    seats: rows.filter((r) => r.seat !== null) as SectionSeatState[],
  };
}
