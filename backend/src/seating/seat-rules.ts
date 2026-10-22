import { BadRequestException } from '@nestjs/common';
import type { Prisma, TicketTier } from '@prisma/client';
import type { LockedEvent } from '../common/event-lock';

/** A seat by its label (spec 007 research R1): its section's name, row, and seat. */
export interface SeatLabel {
  section: string;
  row: number;
  seat: number;
}

/** A seat label with the id of its section in the venue's current layout. */
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
 * every seat rule: in the venue's layout, of the given tier's sections (any section for an event
 * without tiers), and not repeated (`400`). Orders and reservations share it, so a seat that can be
 * reserved is exactly a seat that can be ordered. Whether a seat is taken is checked by the caller.
 */
export async function resolveSeats(
  tx: Prisma.TransactionClient,
  event: LockedEvent,
  tier: TicketTier | null,
  choices: SeatChoiceInput[],
): Promise<ResolvedSeat[]> {
  const sections = await tx.section.findMany({ where: { locationId: event.locationId } });
  const mappings = tier ? await tx.sectionTier.findMany({ where: { eventId: event.id } }) : [];
  const resolved: ResolvedSeat[] = [];
  const keys = new Set<string>();
  for (const choice of choices) {
    const section = sections.find((s) => s.id === choice.sectionId);
    if (!section) throw badSeats(`section ${choice.sectionId} is not part of this venue's layout`);
    const label = { section: section.name, row: choice.row, seat: choice.seat };
    if (choice.row > section.rows || choice.seat > section.seatsPerRow) {
      throw badSeats(`${seatText(label)} is not in the layout`);
    }
    // One tier per order (spec 007 Clarifications): every seat's section is mapped to its tier.
    if (tier && mappings.find((m) => m.sectionId === section.id)?.tierId !== tier.id) {
      throw badSeats(`${seatText(label)} is not sold as ${tier.name}`);
    }
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
