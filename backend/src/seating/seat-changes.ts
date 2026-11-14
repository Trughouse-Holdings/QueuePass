import { Prisma } from '@prisma/client';
import type { SeatStateChange } from '@queuepass/shared';
import { SEAT_LEVEL_SQL } from './seat-levels';

type Tx = Prisma.TransactionClient;
type SeatState = SeatStateChange['state'];

/** A seat that left a state (spec 038 research R12); `seatId` null when the seat was deleted. */
export interface SeatMove {
  seatId: string | null;
  from: SeatState;
}

/** What a seat-changing transaction publishes once it has committed (research R12). */
export interface SeatChanges {
  changes: SeatStateChange[];
  /** The event's `seatSeq` after this transaction; `null` when it changed no seat. */
  seq: number | null;
}

export const NO_SEAT_CHANGES: SeatChanges = { changes: [], seq: null };

/**
 * Spec 015 research R9, spec 038 research R12: seats as live changes, by `{sectionId, row,
 * seat}` with the state each left and its level, read from the seats themselves. A seat repeated
 * is sent once (its first move); a seat that is gone, or not of the event's layout, has nothing to
 * show and is left out.
 */
export async function toChanges(
  tx: Pick<Tx, '$queryRaw'>,
  layoutId: string | null,
  moves: SeatMove[],
  state: SeatState,
): Promise<SeatStateChange[]> {
  const first = new Map<string, SeatState>();
  for (const m of moves) {
    if (m.seatId !== null && !first.has(m.seatId)) first.set(m.seatId, m.from);
  }
  if (first.size === 0 || layoutId === null) return [];
  const ids = Prisma.join([...first.keys()].map((id) => Prisma.sql`${id}::uuid`));
  const seats = await tx.$queryRaw<
    { seatId: string; sectionId: string; row: number; seat: number; levelId: string }[]
  >`
    SELECT s."id"::text AS "seatId", sec."id"::text AS "sectionId", r."number" AS "row",
           s."number" AS "seat", ${SEAT_LEVEL_SQL}::text AS "levelId"
    FROM "Seat" s
    JOIN "SeatRow" r ON r."id" = s."rowId"
    JOIN "Section" sec ON sec."id" = s."sectionId"
    WHERE s."id" IN (${ids}) AND sec."layoutId" = ${layoutId}::uuid
    ORDER BY sec."position", r."number", s."number"`;
  return seats.map((s) => ({
    sectionId: s.sectionId,
    row: s.row,
    seat: s.seat,
    state,
    from: first.get(s.seatId) as SeatState,
    levelId: s.levelId,
  }));
}

/**
 * Spec 038 research R12: a transaction that changed seats increments its event's `seatSeq` once,
 * under the event lock it holds, and its changes are published with that `seq` after it commits.
 * A transaction that changed none leaves `seatSeq` as it is.
 */
export async function sequence(
  tx: Pick<Tx, '$queryRaw'>,
  eventId: string,
  changes: SeatStateChange[],
): Promise<SeatChanges> {
  if (changes.length === 0) return NO_SEAT_CHANGES;
  const [{ seq }] = await tx.$queryRaw<{ seq: bigint }[]>`
    UPDATE "Event" SET "seatSeq" = "seatSeq" + 1 WHERE "id" = ${eventId}::uuid
    RETURNING "seatSeq" AS "seq"`;
  return { changes, seq: Number(seq) };
}
