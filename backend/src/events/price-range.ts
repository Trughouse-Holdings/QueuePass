import { Prisma } from '@prisma/client';
import { SEAT_LEVEL_SQL } from '../seating/seat-levels';

/**
 * Spec 038 FR-024, research R9: a seated event's `priceMax`, the highest price of a level of its
 * layout with at least one seat on sale (a seat whose resolved level is that level, R1, with no
 * EventOffSaleSeat row for the event). `null` for general admission, so no query is made for it.
 * One grouped statement for any number of events (the event list).
 */
export async function priceMaxes(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  events: { id: string; layoutId: string | null }[],
): Promise<Map<string, string>> {
  const seated = events.filter((e) => e.layoutId !== null).map((e) => e.id);
  if (seated.length === 0) return new Map();
  const rows = await db.$queryRaw<{ eventId: string; priceMax: Prisma.Decimal }[]>`
    SELECT p."eventId"::text AS "eventId", max(p."price") AS "priceMax"
    FROM "EventLevelPrice" p
    JOIN "Event" e ON e."id" = p."eventId"
    WHERE p."eventId" = ANY(${seated}::uuid[])
      AND EXISTS (
        SELECT 1
        FROM "Section" sec
        JOIN "Seat" s ON s."sectionId" = sec."id"
        JOIN "SeatRow" r ON r."id" = s."rowId"
        WHERE sec."layoutId" = e."layoutId"
          AND ${SEAT_LEVEL_SQL} = p."levelId"
          AND NOT EXISTS (
            SELECT 1 FROM "EventOffSaleSeat" o WHERE o."eventId" = e."id" AND o."seatId" = s."id"))
    GROUP BY p."eventId"`;
  return new Map(rows.map((r) => [r.eventId, new Prisma.Decimal(r.priceMax).toFixed(2)]));
}
