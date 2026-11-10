import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { conflict } from '../common/conflict';
import type { SeatStateChange } from '@queuepass/shared';
import { closeHolds, closeRunOut, toChanges } from '../reservations/holds';
import { recalcSeatedTiers } from '../seating/tier-seats';

/**
 * Spec 031 (research R4, R9): the ticket types and reserved seating a schedule brings, checked
 * and planned before the first write, then written in the transaction that writes the event.
 * The rules are `004`'s and `007`'s for a new event, restated here with the same messages, the
 * field's path in front (research R3), because `TiersService` and `SeatMapService` need the event
 * committed first.
 */

/** One ticket type as the request carries it (`EventTierInput`). */
export interface SetupTier {
  /** Spec 035: on an update, the existing type to keep; refused on a schedule. */
  id?: string;
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

/** Spec 035 (research R8): `id` is only for `updateEvent`. */
export function assertNoTierIdsOnCreate(input: SetupInput): void {
  for (const [i, tier] of (input.tiers ?? []).entries()) {
    if (tier.id !== undefined) {
      throw refuse(`tiers.${i}.id is not allowed when scheduling`);
    }
  }
}

/** One existing ticket type, as the update planner reads it. */
export interface ExistingSetupTier {
  id: string;
  name: string;
}

/** One current section mapping, with the section's name for hold-closing and refusals. */
export interface ExistingSetupMapping {
  sectionId: string;
  sectionName: string;
  tierId: string;
}

/** Sold-ticket counts the planner needs; gathered under the event lock. */
export interface UpdateSetupCounts {
  eventSold: number;
  tierlessSold: number;
  soldByTier: Map<string, number>;
  ordersByTier: Map<string, number>;
  soldBySection: Map<string, number>;
}

export interface PlannedUpdateTier extends PlannedTier {
  /** Present when this entry keeps an existing type. */
  id?: string;
}

export interface EventUpdatePlan extends EventSetupPlan {
  tiers: PlannedUpdateTier[];
  removed: ExistingSetupTier[];
}

export interface UpdateSetupInput {
  eventName: string;
  reservedSeatingBefore: boolean;
  existingTiers: ExistingSetupTier[];
  existingMappings: ExistingSetupMapping[];
  counts: UpdateSetupCounts;
  venue: SetupVenue;
  sections: SetupSection[];
  /** The event's ticket capacity in force after this update's detail checks. */
  capacity: number;
}

/**
 * Spec 035 (research R8): the complete new set of ticket types and seating for an update, checked
 * before the first write. Ids, sold-ticket rules, then the same shape checks as `planEventSetup`.
 */
export function planEventUpdate(input: SetupInput, ctx: UpdateSetupInput): EventUpdatePlan {
  const byId = new Map(ctx.existingTiers.map((t) => [t.id, t]));
  const seen = new Set<string>();
  for (const [i, tier] of (input.tiers ?? []).entries()) {
    const path = `tiers.${i}.id`;
    if (tier.id === undefined) continue;
    if (!byId.has(tier.id)) {
      throw refuse(`${path} is not a ticket type of this event`);
    }
    if (seen.has(tier.id)) {
      throw refuse(`${path} lists a ticket type already listed in this request`);
    }
    seen.add(tier.id);
  }

  const reservedAfter = input.reservedSeating === true;
  if (reservedAfter !== ctx.reservedSeatingBefore && ctx.counts.eventSold > 0) {
    throw conflict(
      'EVENT_HAS_ORDERS',
      `${ctx.eventName} has sold tickets, so reserved seating can no longer be switched ` +
        `${reservedAfter ? 'on' : 'off'}.`,
      { field: 'reservedSeating', ticketsSold: ctx.counts.eventSold },
    );
  }

  const kept = new Set((input.tiers ?? []).flatMap((t) => (t.id !== undefined ? [t.id] : [])));
  const removed = ctx.existingTiers.filter((t) => !kept.has(t.id));
  for (const t of removed) {
    const orders = ctx.counts.ordersByTier.get(t.id) ?? 0;
    if (orders > 0) {
      throw conflict(
        'TIER_HAS_ORDERS',
        `Cannot remove the tier "${t.name}": it has ${orders} ${orders === 1 ? 'order' : 'orders'}.`,
        { field: 'tiers', orderCount: orders },
      );
    }
  }

  if (
    ctx.existingTiers.length === 0 &&
    (input.tiers ?? []).length > 0 &&
    ctx.counts.tierlessSold > 0
  ) {
    throw conflict(
      'EVENT_HAS_ORDERS',
      `${ctx.eventName} has already sold ${ctx.counts.tierlessSold} tickets without tiers, so ` +
        'tiers cannot be added.',
      { field: 'tiers', tierlessTicketsSold: ctx.counts.tierlessSold },
    );
  }

  const planned = planEventSetup(input, ctx.venue, ctx.sections, ctx.capacity);
  const withIds: PlannedUpdateTier[] = planned.tiers.map((t, i) => ({
    ...t,
    id: input.tiers![i]!.id,
  }));

  const beforeOwner = new Map(ctx.existingMappings.map((m) => [m.sectionId, m.tierId]));
  const afterOwner = new Map<string, { index: number; id?: string }>();
  for (const [i, tier] of withIds.entries()) {
    for (const sectionId of tier.sectionIds) {
      afterOwner.set(sectionId, { index: i, id: tier.id });
    }
  }
  const sectionName = new Map(ctx.sections.map((s) => [s.id, s.name]));
  for (const m of ctx.existingMappings) {
    sectionName.set(m.sectionId, m.sectionName);
  }
  for (const [sectionId, before] of beforeOwner) {
    const after = afterOwner.get(sectionId);
    const afterKey = after?.id ?? (after ? `new:${after.index}` : null);
    if ((before ?? null) === (after?.id ?? null) && afterKey !== `new:${after?.index ?? ''}`) {
      // Same existing type still owns it, or both unmapped — wait, if before is set and after is
      // the same id, skip. If after is a new type, that's a move even if... new types have no id.
      if (after?.id === before) continue;
    }
    if (after?.id === before) continue;
    const sold = ctx.counts.soldBySection.get(sectionId) ?? 0;
    if (sold <= 0) continue;
    const name = sectionName.get(sectionId) ?? 'section';
    const field = after !== undefined ? `tiers.${after.index}.sectionIds` : 'tiers';
    throw conflict('EVENT_HAS_ORDERS', `Section ${name} has sold seats, so it stays in its tier.`, {
      field,
      section: name,
      ticketsSold: sold,
    });
  }

  for (const [i, tier] of withIds.entries()) {
    if (!tier.id) continue;
    const sold = ctx.counts.soldByTier.get(tier.id) ?? 0;
    if (tier.quantity < sold) {
      throw conflict(
        'CAPACITY_EXCEEDED',
        `Cannot set ${tier.name} to ${tier.quantity} tickets; ${sold} are already sold.`,
        { field: `tiers.${i}.quantity`, requested: tier.quantity, ticketsSold: sold },
      );
    }
  }

  return {
    reservedSeating: planned.reservedSeating,
    capacityFromLayout: planned.capacityFromLayout,
    tiers: withIds,
    removed,
  };
}

/**
 * Spec 035 (research R8): apply a planned update inside the event's update transaction. Closes
 * holds on remapped sections or when reserved seating is turned off, as `updateSeating` does.
 * Returns the seat changes to publish after commit.
 */
export async function writeEventUpdate(
  tx: Prisma.TransactionClient,
  eventId: string,
  locationId: string,
  plan: EventUpdatePlan,
  before: { reservedSeating: boolean; mappings: ExistingSetupMapping[] },
): Promise<SeatStateChange[]> {
  const nextOwner = new Map<string, string>();
  for (const [i, t] of plan.tiers.entries()) {
    const key = t.id ?? `new:${i}`;
    for (const sectionId of t.sectionIds) nextOwner.set(sectionId, key);
  }
  const moved = new Set(
    before.mappings
      .filter((m) => (nextOwner.get(m.sectionId) ?? null) !== m.tierId)
      .map((m) => m.sectionName),
  );
  // A section newly mapped (not in before) does not need holds closed on a name it never had.
  for (const m of before.mappings) {
    if (!nextOwner.has(m.sectionId) && !moved.has(m.sectionName)) moved.add(m.sectionName);
  }

  const freed = [
    ...(await closeRunOut(tx, eventId)),
    ...(await closeHolds(tx, eventId, (h) => !plan.reservedSeating || moved.has(h.section))),
  ];
  const opened = await toChanges(tx, locationId, freed, 'open');

  await tx.sectionTier.deleteMany({ where: { eventId } });

  for (const t of plan.removed) {
    await tx.ticketTier.delete({ where: { id: t.id } });
  }

  // Two-phase names so a swap cannot hit the unique index mid-update.
  for (const t of plan.tiers) {
    if (!t.id) continue;
    await tx.ticketTier.update({
      where: { id: t.id },
      data: { name: `__qp035_${t.id}`, price: t.price, quantity: t.quantity },
    });
  }
  const createdIds: string[] = [];
  for (const t of plan.tiers) {
    if (t.id) {
      await tx.ticketTier.update({
        where: { id: t.id },
        data: { name: t.name, price: t.price, quantity: t.quantity },
      });
      createdIds.push(t.id);
    } else {
      const created = await tx.ticketTier.create({
        data: { eventId, name: t.name, price: t.price, quantity: t.quantity },
        select: { id: true },
      });
      createdIds.push(created.id);
    }
  }

  const mappings: Prisma.SectionTierCreateManyInput[] = [];
  for (const [i, t] of plan.tiers.entries()) {
    const tierId = createdIds[i]!;
    for (const sectionId of t.sectionIds) mappings.push({ eventId, sectionId, tierId });
  }
  if (mappings.length > 0) await tx.sectionTier.createMany({ data: mappings });
  if (plan.reservedSeating) await recalcSeatedTiers(tx, eventId);
  return opened;
}
