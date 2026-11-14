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
 * Spec 038 research R11, R12: every seat of an event's layout counted per section and resolved
 * level by its state for that event, in one grouped statement, with the event's `seatSeq` read in
 * that same statement (so a change is either in the counts or has a greater `seq`, never both). A
 * seat's state, in this order: `offSale` (an EventOffSaleSeat row), `sold` (a VALID ticket),
 * `reserved` (a live hold of an active reservation, by the database's clock: a run-out reservation
 * the sweep hasn't closed is already open, spec 015 research R3), else `open`. Rows are in section
 * position, then level rank order. A general-admission event has none; no event is a 404.
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
             CASE WHEN o."seatId" IS NOT NULL THEN 'offSale'
                  WHEN t."id" IS NOT NULL THEN 'sold'
                  WHEN h."id" IS NOT NULL THEN 'reserved'
                  ELSE 'open' END AS state
      FROM e
      JOIN "Section" sec ON sec."layoutId" = e."layoutId"
      JOIN "Seat" s ON s."sectionId" = sec."id"
      JOIN "SeatRow" r ON r."id" = s."rowId"
      LEFT JOIN "EventOffSaleSeat" o ON o."eventId" = e."id" AND o."seatId" = s."id"
      LEFT JOIN "Ticket" t ON t."eventId" = e."id" AND t."seatId" = s."id" AND t."status" = 'VALID'
      LEFT JOIN ("SeatHold" h
                 JOIN "SeatReservation" sr ON sr."id" = h."reservationId"
                  AND sr."endedAt" IS NULL AND now() < sr."expiresAt")
             ON h."eventId" = e."id" AND h."seatId" = s."id" AND h."releasedAt" IS NULL
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
