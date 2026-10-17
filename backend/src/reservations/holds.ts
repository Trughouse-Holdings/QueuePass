import { Prisma, type SeatHoldEnd } from '@prisma/client';
import type { SeatStateChange } from '@queuepass/shared';
import { conflict } from '../common/conflict';
import { seatKey, seatText, sortSeats, type SeatLabel } from '../seating/seat-rules';

/**
 * Spec 015: the hold operations every locked path shares (data-model.md; research R3, R7, R11).
 * Each takes the caller's transaction, which already holds the event's `lockEvent` row lock, so
 * they never take a lock of their own. Times are the database's `now()` (research R3).
 */

type Tx = Prisma.TransactionClient;

/** A live hold, with the customer and tier of its reservation. */
export interface LiveHold extends SeatLabel {
  id: string;
  reservationId: string;
  customerSub: string;
  tierId: string | null;
}

/**
 * Research R3: ends the event's reservations whose 5 minutes have run out, at exactly
 * `expiresAt`, and their live holds with `EXPIRED`, so the 2-minute wait starts at the end of the
 * 5 minutes however late this runs. Every locked path calls it first. Returns the freed seats.
 */
export async function closeRunOut(tx: Tx, eventId: string): Promise<SeatLabel[]> {
  const freed = await tx.$queryRaw<{ seatSection: string; seatRow: number; seatNumber: number }[]>`
    WITH ended AS (
      UPDATE "SeatReservation" SET "endedAt" = "expiresAt"
      WHERE "eventId" = ${eventId}::uuid AND "endedAt" IS NULL AND "expiresAt" <= now()
      RETURNING "id", "expiresAt"
    )
    UPDATE "SeatHold" h SET "releasedAt" = ended."expiresAt", "endReason" = 'EXPIRED'
    FROM ended
    WHERE h."reservationId" = ended."id" AND h."releasedAt" IS NULL
    RETURNING h."seatSection", h."seatRow", h."seatNumber"`;
  return freed.map((h) => ({ section: h.seatSection, row: h.seatRow, seat: h.seatNumber }));
}

/** The event's live holds (every one is active once `closeRunOut` has run under the lock). */
export async function liveHolds(tx: Tx, eventId: string): Promise<LiveHold[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      reservationId: string;
      customerSub: string;
      tierId: string | null;
      seatSection: string;
      seatRow: number;
      seatNumber: number;
    }[]
  >`
    SELECT h."id", h."reservationId", r."customerSub", r."tierId", h."seatSection", h."seatRow",
           h."seatNumber"
    FROM "SeatHold" h JOIN "SeatReservation" r ON r."id" = h."reservationId"
    WHERE h."eventId" = ${eventId}::uuid AND h."releasedAt" IS NULL`;
  return rows.map((h) => ({
    id: h.id,
    reservationId: h.reservationId,
    customerSub: h.customerSub,
    tierId: h.tierId,
    section: h.seatSection,
    row: h.seatRow,
    seat: h.seatNumber,
  }));
}

/**
 * Ends these holds now with a reason, then ends every reservation of the event left with no live
 * hold (research R7, R8, R11).
 */
export async function endHolds(
  tx: Tx,
  eventId: string,
  holds: { id: string }[],
  reason: SeatHoldEnd,
): Promise<void> {
  if (holds.length === 0) return;
  const ids = Prisma.join(holds.map((h) => Prisma.sql`${h.id}::uuid`));
  await tx.$executeRaw`
    UPDATE "SeatHold" SET "releasedAt" = now(), "endReason" = ${reason}::"SeatHoldEnd"
    WHERE "id" IN (${ids}) AND "releasedAt" IS NULL`;
  // greatest(): a reservation made by a transaction that started after this one (and committed
  // before this one took the lock) has a later createdAt than this transaction's now().
  await tx.$executeRaw`
    UPDATE "SeatReservation" r SET "endedAt" = greatest(now(), r."createdAt")
    WHERE r."eventId" = ${eventId}::uuid AND r."endedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "SeatHold" h WHERE h."reservationId" = r."id" AND h."releasedAt" IS NULL
      )`;
}

/**
 * Spec 015 FR-016 (research R11): an admin change or the sales close ends these holds `CLOSED`,
 * which starts no 2-minute wait, and returns their seats for publishing as open.
 */
export async function closeHolds(
  tx: Tx,
  eventId: string,
  which: (h: LiveHold) => boolean = () => true,
): Promise<SeatLabel[]> {
  const holds = (await liveHolds(tx, eventId)).filter(which);
  await endHolds(tx, eventId, holds, 'CLOSED');
  return holds;
}

/**
 * Spec 015 research R9: seats as live changes, by the current layout's section ids. A seat whose
 * section is gone (a replaced layout) has nothing left to show, so it is left out.
 */
export async function toChanges(
  tx: Pick<Tx, 'section'>,
  locationId: string,
  seats: SeatLabel[],
  state: SeatStateChange['state'],
): Promise<SeatStateChange[]> {
  if (seats.length === 0) return [];
  const sections = await tx.section.findMany({ where: { locationId } });
  const seen = new Set<string>();
  const changes: SeatStateChange[] = [];
  for (const s of seats) {
    const section = sections.find((x) => x.name === s.section);
    if (!section || seen.has(seatKey(s))) continue;
    seen.add(seatKey(s));
    changes.push({ sectionId: section.id, row: s.row, seat: s.seat, state });
  }
  return changes;
}

/**
 * Spec 015 research R5, R7: seats with a valid ticket or in another customer's reservation, as one
 * `409 SEAT_TAKEN` naming them all, with `details.reserved` for those reserved rather than sold.
 */
export function seatsTaken(sold: SeatLabel[], reserved: SeatLabel[]) {
  const seats = sortSeats(
    [...sold, ...reserved].map(({ section, row, seat }) => ({ section, row, seat })),
  );
  const them = (list: SeatLabel[]) =>
    `${sortSeats(list).map(seatText).join('; ')} ${list.length === 1 ? 'is' : 'are'}`;
  const message = [
    sold.length > 0 ? `${them(sold)} already taken.` : '',
    reserved.length > 0 ? `${them(reserved)} reserved by another customer.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return conflict('SEAT_TAKEN', message, {
    seats,
    ...(reserved.length > 0
      ? { reserved: sortSeats(reserved.map(({ section, row, seat }) => ({ section, row, seat }))) }
      : {}),
  });
}
