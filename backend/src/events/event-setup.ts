import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { conflict } from '../common/conflict';

/**
 * Spec 031 (research R4, R9): the ticket types and reserved seating a schedule brings, checked
 * and planned before the first write, then written in the transaction that writes the event.
 * The rules are `004`'s and `007`'s for a new event, restated here with the same messages, the
 * field's path in front (research R3), because `TiersService` and `SeatMapService` need the event
 * committed first.
 */

/** One ticket type as the request carries it (`EventTierInput`). */
export interface SetupTier {
  name: string;
  price: string;
  quantity?: number;
  sectionIds?: string[];
}

/** The part of the scheduling request the planner reads. */
export interface SetupInput {
  /** The event's name, for the capacity message. */
  name: string;
  totalTicketCapacity?: number;
  reservedSeating?: boolean;
  tiers?: SetupTier[];
}

export interface SetupVenue {
  name: string;
  seatingCapacity: number;
}

export interface SetupSection {
  id: string;
  name: string;
  rows: number;
  seatsPerRow: number;
}

export interface PlannedTier {
  name: string;
  price: string;
  /** Typed without reserved seating; with it, the seats of its sections (0 for none). */
  quantity: number;
  sectionIds: string[];
}

export interface EventSetupPlan {
  reservedSeating: boolean;
  /** With reserved seating, the layout's total seats, the event's capacity; else `null`. */
  capacityFromLayout: number | null;
  tiers: PlannedTier[];
}

const refuse = (message: string): BadRequestException =>
  new BadRequestException({ message: [message] });

const seats = (s: SetupSection): number => s.rows * s.seatsPerRow;

/**
 * R4 step 2: with reserved seating, the venue needs a layout and no capacity may be typed; the
 * event's capacity is then the layout's total. `null` without reserved seating.
 */
export function seatingCapacity(
  input: SetupInput,
  venue: SetupVenue,
  sections: SetupSection[],
): number | null {
  if (!input.reservedSeating) return null;
  if (sections.length === 0) {
    throw refuse(`reservedSeating needs a seating layout; ${venue.name} has none`);
  }
  if (input.totalTicketCapacity !== undefined) {
    throw refuse(
      "totalTicketCapacity is set by the venue's seating layout while reserved seating is on",
    );
  }
  return sections.reduce((n, s) => n + seats(s), 0);
}

/**
 * The event's ticket capacity: with reserved seating the layout's total (R4 step 2, refusing as
 * `seatingCapacity` does), else the typed one, else the venue's (spec 007 FR-019).
 */
export function eventCapacity(
  input: SetupInput,
  venue: SetupVenue,
  sections: SetupSection[],
): number {
  return (
    seatingCapacity(input, venue, sections) ?? input.totalTicketCapacity ?? venue.seatingCapacity
  );
}

/**
 * R4 steps 2, 4, and 5, pure: the seating, each ticket type in the order sent, then their total.
 * Throws the first refusal; never throws for a request without `tiers` and `reservedSeating`.
 * `sections` is the venue's layout as read under the venue's lock (empty without reserved
 * seating). `capacity` is the event's, from `eventCapacity`: `createLocked` passes the one it
 * already checked (so step 2 has run), and left out it is worked out here, step 2 included.
 */
export function planEventSetup(
  input: SetupInput,
  venue: SetupVenue,
  sections: SetupSection[],
  capacity: number = eventCapacity(input, venue, sections),
): EventSetupPlan {
  const reserved = input.reservedSeating === true;
  const capacityFromLayout = reserved ? capacity : null;
  const byId = new Map(sections.map((s) => [s.id, s]));
  /** Each section listed so far, and the index of the type that lists it. */
  const owner = new Map<string, number>();
  const planned: PlannedTier[] = [];

  for (const [i, tier] of (input.tiers ?? []).entries()) {
    const path = `tiers.${i}`;
    const name = tier.name.trim();
    const key = name.toLowerCase();
    const earlier = planned.findIndex((p) => p.name.toLowerCase() === key);
    if (earlier >= 0) {
      throw conflict(
        'TIER_NAME_TAKEN',
        `Ticket type ${i + 1}, '${name}', has the same name as ticket type ${earlier + 1}, ` +
          `'${planned[earlier].name}'. Give each ticket type its own name.`,
        { field: `${path}.name` },
      );
    }

    const sectionIds = tier.sectionIds ?? [];
    let quantity: number;
    if (reserved) {
      if (tier.quantity !== undefined) {
        throw refuse(
          `${path}.quantity must be omitted: it follows this tier's sections while reserved ` +
            'seating is on',
        );
      }
      quantity = 0;
      for (const id of sectionIds) {
        const section = byId.get(id);
        if (!section) {
          throw refuse(
            `${path}.sectionIds lists a section that is not in ${venue.name}'s seating layout. ` +
              'Reload the form to see its sections.',
          );
        }
        const j = owner.get(id);
        if (j === i) throw refuse(`${path}.sectionIds lists a section more than once`);
        if (j !== undefined) {
          throw refuse(
            `${path}.sectionIds lists section ${section.name}, which ticket type ${j + 1}, ` +
              `'${planned[j].name}', already sells. A section sells one ticket type.`,
          );
        }
        owner.set(id, i);
        quantity += seats(section);
      }
    } else {
      if (tier.quantity === undefined) {
        throw refuse(`${path}.quantity is required for a tier`);
      }
      if (sectionIds.length > 0) {
        throw refuse(
          `${path}.sectionIds needs reserved seating: a ticket type sells sections only when ` +
            'reservedSeating is true',
        );
      }
      quantity = tier.quantity;
    }
    planned.push({ name, price: tier.price, quantity, sectionIds: [...sectionIds] });
  }

  // R4 step 5: without reserved seating, the typed quantities within the event's capacity.
  if (!reserved && planned.length > 0) {
    const tierTotal = planned.reduce((n, t) => n + t.quantity, 0);
    if (tierTotal > capacity) {
      throw conflict(
        'CAPACITY_EXCEEDED',
        `${input.name} has ${capacity} tickets, but its ticket types add up to ${tierTotal}.`,
        { field: 'tiers', totalTicketCapacity: capacity, tierTotal },
      );
    }
  }

  return { reservedSeating: reserved, capacityFromLayout, tiers: planned };
}

/**
 * R4 step 6, after the event row: each ticket type in order, then every section's mapping in one
 * insert. Inside the scheduling transaction, so a failure here leaves nothing (FR-003).
 */
export async function writeEventSetup(
  tx: Prisma.TransactionClient,
  eventId: string,
  plan: EventSetupPlan,
): Promise<void> {
  const mappings: Prisma.SectionTierCreateManyInput[] = [];
  for (const t of plan.tiers) {
    const created = await tx.ticketTier.create({
      data: { eventId, name: t.name, price: t.price, quantity: t.quantity },
      select: { id: true },
    });
    for (const sectionId of t.sectionIds) mappings.push({ eventId, sectionId, tierId: created.id });
  }
  if (mappings.length > 0) await tx.sectionTier.createMany({ data: mappings });
}
