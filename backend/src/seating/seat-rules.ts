import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LockedEvent } from '../common/event-lock';
import { conflict } from '../common/conflict';
import { SEAT_LEVEL_SQL } from './seat-levels';

/** A seat by its label (spec 007 research R1): its section's name, row, and seat. */
export interface SeatLabel {
  section: string;
  row: number;
  seat: number;
}

/**
 * Spec 038 (research R1, R2, R10): a seat of the event's layout as a request names it, with the
 * seat itself, its labels and its resolved level.
 */
export interface ResolvedSeat extends SeatLabel {
  seatId: string;
  sectionId: string;
  rowLabel: string;
  seatLabel: string;
  levelId: string;
  levelName: string;
}

/** A seat as a customer chooses it (contracts/openapi.yaml `SeatChoice`). */
export interface SeatChoiceInput {
  sectionId: string;
  row: number;
  seat: number;
}

/** "Section 115, Row F, Seat 7": the labels people read when known, else the numbers. */
export const seatText = (s: SeatLabel & { rowLabel?: string; seatLabel?: string }): string =>
  `Section ${s.section}, Row ${s.rowLabel ?? s.row}, Seat ${s.seatLabel ?? s.seat}`;
export const seatKey = (s: SeatLabel): string => `${s.section}\u0000${s.row}\u0000${s.seat}`;
export const badSeats = (message: string): BadRequestException =>
  new BadRequestException({ message: [message] });

/** Labels in a stable order, for refusals that list seats. */
export const sortSeats = <T extends SeatLabel>(seats: T[]): T[] =>
  [...seats].sort((a, b) => seatKey(a).localeCompare(seatKey(b)));

/** Only the label of a seat, as refusals' `details.seats` give it. */
export const labelOf = ({ section, row, seat }: SeatLabel): SeatLabel => ({ section, row, seat });

/**
 * Spec 007 FR-008, research R6; spec 015 research R5; spec 038 research R2, R10: the seats a
 * request names, after every seat rule: a seat of the event's layout, by its section's id, its
 * row's number and its own number (`400`), not repeated (`400`), and on sale for this event
 * (`409 SEAT_OFF_SALE`, `details.seats` as the request named them). Orders and reservations share
 * it, so a seat that can be reserved is exactly a seat that can be ordered. One statement reads
 * every seat with its labels and level (`COALESCE(seat, row, section)`, R1). There is no ticket
 * type rule: one reservation or order may take seats of any levels (FR-021). Whether a seat is
 * taken is checked by the caller, under the same event lock.
 */
export async function resolveSeats(
  tx: Prisma.TransactionClient,
  event: LockedEvent,
  choices: SeatChoiceInput[],
): Promise<ResolvedSeat[]> {
  if (choices.length === 0 || event.layoutId === null) {
    if (choices.length > 0) throw badSeats('seats can only be chosen at an event with a layout');
    return [];
  }
  const sections = new Map(
    (
      await tx.section.findMany({
        where: { layoutId: event.layoutId },
        select: { id: true, name: true },
      })
    ).map((s) => [s.id, s.name]),
  );
  for (const c of choices) {
    if (!sections.has(c.sectionId)) {
      throw badSeats(`section ${c.sectionId} is not part of this event's layout`);
    }
  }
  const wanted = Prisma.join(
    choices.map((c) => Prisma.sql`(${c.sectionId}::uuid, ${c.row}::int, ${c.seat}::int)`),
  );
  const found = await tx.$queryRaw<
    {
      seatId: string;
      sectionId: string;
      section: string;
      row: number;
      seat: number;
      rowLabel: string;
      seatLabel: string;
      levelId: string;
      levelName: string;
      offSale: boolean;
    }[]
  >`
    WITH wanted ("sectionId", "row", "seat") AS (VALUES ${wanted})
    SELECT s."id"::text AS "seatId", sec."id"::text AS "sectionId", sec."name" AS "section",
           r."number" AS "row", s."number" AS "seat", r."label" AS "rowLabel",
           s."label" AS "seatLabel", pl."id"::text AS "levelId", pl."name" AS "levelName",
           (o."seatId" IS NOT NULL) AS "offSale"
    FROM wanted w
    JOIN "Section" sec ON sec."id" = w."sectionId"
    JOIN "SeatRow" r ON r."sectionId" = sec."id" AND r."number" = w."row"
    JOIN "Seat" s ON s."rowId" = r."id" AND s."number" = w."seat"
    JOIN "PriceLevel" pl ON pl."id" = ${SEAT_LEVEL_SQL}
    LEFT JOIN "EventOffSaleSeat" o ON o."eventId" = ${event.id}::uuid AND o."seatId" = s."id"`;
  const byPlace = new Map(found.map((f) => [`${f.sectionId}/${f.row}/${f.seat}`, f]));

  const resolved: ResolvedSeat[] = [];
  const seen = new Set<string>();
  const offSale: SeatChoiceInput[] = [];
  for (const c of choices) {
    const label = { section: sections.get(c.sectionId) as string, row: c.row, seat: c.seat };
    const seat = byPlace.get(`${c.sectionId}/${c.row}/${c.seat}`);
    if (!seat) throw badSeats(`${seatText(label)} is not in the layout`);
    if (seen.has(seat.seatId)) throw badSeats(`${seatText(seat)} is listed twice`);
    seen.add(seat.seatId);
    if (seat.offSale) offSale.push({ sectionId: c.sectionId, row: c.row, seat: c.seat });
    const { offSale: _off, ...rest } = seat;
    resolved.push(rest);
  }
  if (offSale.length > 0) {
    const named = resolved.filter((r) =>
      offSale.some((o) => o.sectionId === r.sectionId && o.row === r.row && o.seat === r.seat),
    );
    throw conflict(
      'SEAT_OFF_SALE',
      `${named.map(seatText).join('; ')} ${named.length === 1 ? 'is' : 'are'} not on sale for ` +
        `${event.name}.`,
      { seats: offSale },
    );
  }
  return resolved;
}

/** Spec 007 FR-009, spec 038 FR-025: which of these seats a valid ticket holds, by the seat itself. */
export async function soldSeats(
  tx: Prisma.TransactionClient,
  eventId: string,
  seats: ResolvedSeat[],
): Promise<SeatLabel[]> {
  if (seats.length === 0) return [];
  const taken = await tx.ticket.findMany({
    where: { eventId, status: 'VALID', seatId: { in: seats.map((s) => s.seatId) } },
    select: { seatId: true },
  });
  const ids = new Set(taken.map((t) => t.seatId));
  return sortSeats(seats.filter((s) => ids.has(s.seatId)).map(labelOf));
}
