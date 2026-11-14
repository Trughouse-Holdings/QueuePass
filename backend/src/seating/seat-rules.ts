import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { LockedEvent } from '../common/event-lock';

/** A seat by its label (spec 007 research R1): its section's name, row, and seat. */
export interface SeatLabel {
  section: string;
  row: number;
  seat: number;
}

/** A seat label with the id of its section in the event's layout. */
export interface ResolvedSeat extends SeatLabel {
  sectionId: string;
}

/** A seat as a customer chooses it (contracts/openapi.yaml `SeatChoice`). */
export interface SeatChoiceInput {
  sectionId: string;
  row: number;
  seat: number;
}

export const seatText = (s: SeatLabel): string =>
  `Section ${s.section}, Row ${s.row}, Seat ${s.seat}`;
export const seatKey = (s: SeatLabel): string => `${s.section}\u0000${s.row}\u0000${s.seat}`;
export const badSeats = (message: string): BadRequestException =>
  new BadRequestException({ message: [message] });

/** Labels in a stable order, for refusals that list seats. */
export const sortSeats = <T extends SeatLabel>(seats: T[]): T[] =>
  [...seats].sort((a, b) => seatKey(a).localeCompare(seatKey(b)));

/**
 * Spec 007 FR-008, research R6; spec 015 research R5: the seats a request names, as labels, after
 * every seat rule: a seat of the event's layout, and not repeated (`400`). Orders and reservations
 * share it, so a seat that can be reserved is exactly a seat that can be ordered. Whether a seat is
 * taken is checked by the caller.
 *
 * Spec 038 (T009): `007`'s section-to-tier rule went with its table (SectionTier); the seat is
 * looked up among the layout's rows and seats by its row's and its own number. T035 makes this
 * return the seat's id, labels and level, and refuse seats off sale.
 */
export async function resolveSeats(
  tx: Prisma.TransactionClient,
  event: LockedEvent,
  choices: SeatChoiceInput[],
): Promise<ResolvedSeat[]> {
  const sections =
    event.layoutId === null
      ? []
      : await tx.section.findMany({ where: { layoutId: event.layoutId } });
  const resolved: ResolvedSeat[] = [];
  const keys = new Set<string>();
  for (const choice of choices) {
    const section = sections.find((s) => s.id === choice.sectionId);
    if (!section) throw badSeats(`section ${choice.sectionId} is not part of this event's layout`);
    const label = { section: section.name, row: choice.row, seat: choice.seat };
    const seat = await tx.seat.findFirst({
      where: { sectionId: section.id, number: choice.seat, row: { number: choice.row } },
      select: { id: true },
    });
    if (!seat) throw badSeats(`${seatText(label)} is not in the layout`);
    if (keys.has(seatKey(label))) throw badSeats(`${seatText(label)} is listed twice`);
    keys.add(seatKey(label));
    resolved.push({ ...label, sectionId: section.id });
  }
  return resolved;
}

/** Spec 007 FR-009: which of these seats a valid ticket holds, sorted. */
export async function soldSeats(
  tx: Prisma.TransactionClient,
  eventId: string,
  seats: SeatLabel[],
): Promise<SeatLabel[]> {
  if (seats.length === 0) return [];
  const taken = await tx.ticket.findMany({
    where: {
      eventId,
      status: 'VALID',
      OR: seats.map((l) => ({ seatSection: l.section, seatRow: l.row, seatNumber: l.seat })),
    },
    select: { seatSection: true, seatRow: true, seatNumber: true },
  });
  return sortSeats(
    taken.map((t) => ({
      section: t.seatSection as string,
      row: t.seatRow as number,
      seat: t.seatNumber as number,
    })),
  );
}
