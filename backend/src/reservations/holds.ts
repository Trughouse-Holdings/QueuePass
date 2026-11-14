import { Prisma, type SeatHoldEnd } from '@prisma/client';
import { conflict } from '../common/conflict';
import type { SeatMove } from '../seating/seat-changes';
import { labelOf, seatText, sortSeats, type SeatLabel } from '../seating/seat-rules';

/**
 * Spec 015: the hold operations every locked path shares (data-model.md; research R3, R7, R11).
 * Each takes the caller's transaction, which already holds the event's `lockEvent` row lock, so
 * they never take a lock of their own. Times are the database's `now()` (research R3).
 */

type Tx = Prisma.TransactionClient;

/** A live hold, with the customer and tier of its reservation, and its seat (spec 038 R10). */
export interface LiveHold extends SeatLabel {
  id: string;
  reservationId: string;
  customerSub: string;
  tierId: string | null;
  seatId: string;
}

/** A seat whose hold ended: the seat itself and its label as held. */
export interface FreedSeat extends SeatLabel {
  seatId: string | null;
}

/**
 * Research R3: ends the event's reservations whose 5 minutes have run out, at exactly
 * `expiresAt`, and their live holds with `EXPIRED`, so the 2-minute wait starts at the end of the
 * 5 minutes however late this runs. Every locked path calls it first. Returns the freed seats.
 */
export async function closeRunOut(tx: Tx, eventId: string): Promise<FreedSeat[]> {
  const freed = await tx.$queryRaw<
    { seatId: string | null; seatSection: string; seatRow: number; seatNumber: number }[]
  >`
    WITH ended AS (
      UPDATE "SeatReservation" SET "endedAt" = "expiresAt"
      WHERE "eventId" = ${eventId}::uuid AND "endedAt" IS NULL AND "expiresAt" <= now()
      RETURNING "id", "expiresAt"
    )
    UPDATE "SeatHold" h SET "releasedAt" = ended."expiresAt", "endReason" = 'EXPIRED'
    FROM ended
    WHERE h."reservationId" = ended."id" AND h."releasedAt" IS NULL
    RETURNING h."seatId"::text AS "seatId", h."seatSection", h."seatRow", h."seatNumber"`;
  return freed.map((h) => ({
    seatId: h.seatId,
    section: h.seatSection,
    row: h.seatRow,
    seat: h.seatNumber,
  }));
}

/** Spec 038 research R12: seats whose holds ended, as moves out of `reserved`. */
export const fromHeld = (seats: { seatId: string | null }[]): SeatMove[] =>
  seats.map((s) => ({ seatId: s.seatId, from: 'reserved' as const }));

/** The event's live holds (every one is active once `closeRunOut` has run under the lock). */
export async function liveHolds(tx: Tx, eventId: string): Promise<LiveHold[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      reservationId: string;
      customerSub: string;
      tierId: string | null;
      seatId: string;
      seatSection: string;
      seatRow: number;
      seatNumber: number;
    }[]
  >`
    SELECT h."id", h."reservationId", r."customerSub", r."tierId", h."seatId"::text AS "seatId",
           h."seatSection", h."seatRow", h."seatNumber"
    FROM "SeatHold" h JOIN "SeatReservation" r ON r."id" = h."reservationId"
    WHERE h."eventId" = ${eventId}::uuid AND h."releasedAt" IS NULL`;
  return rows.map((h) => ({
    id: h.id,
    reservationId: h.reservationId,
    customerSub: h.customerSub,
    tierId: h.tierId,
    seatId: h.seatId,
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
): Promise<LiveHold[]> {
  const holds = (await liveHolds(tx, eventId)).filter(which);
  await endHolds(tx, eventId, holds, 'CLOSED');
  return holds;
}

/**
 * Spec 015 research R5, R7: seats with a valid ticket or in another customer's reservation, as one
 * `409 SEAT_TAKEN` naming them all, with `details.reserved` for those reserved rather than sold.
 */
export function seatsTaken(sold: SeatLabel[], reserved: SeatLabel[]) {
  const seats = sortSeats([...sold, ...reserved].map(labelOf));
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
    ...(reserved.length > 0 ? { reserved: sortSeats(reserved.map(labelOf)) } : {}),
  });
}
