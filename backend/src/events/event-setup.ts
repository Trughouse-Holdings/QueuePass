import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { conflict } from '../common/conflict';

/**
 * Spec 031 (research R4, R9): the ticket types a schedule brings, checked and planned before the
 * first write, then written in the transaction that writes the event. The rules are `004`'s for a
 * new event, restated here with the same messages, the field's path in front (research R3),
 * because `TiersService` needs the event committed first.
 *
 * Spec 038 (T009, contract 2.0.0): `007`'s reserved seating by section-to-type mapping
 * (`reservedSeating`, `sectionIds`) is gone; T023 adds an event's layout, level prices and
 * off-sale seats here.
 */

/** One ticket type as the request carries it (`EventTierInput`). */
export interface SetupTier {
  /** Spec 035: on an update, the existing type to keep; refused on a schedule. */
  id?: string;
  name: string;
  price: string;
  quantity?: number;
}

/** The part of the scheduling request the planner reads. */
export interface SetupInput {
  /** The event's name, for the capacity message. */
  name: string;
  totalTicketCapacity?: number;
  tiers?: SetupTier[];
}

export interface SetupVenue {
  name: string;
  seatingCapacity: number;
}

export interface PlannedTier {
  name: string;
  price: string;
  quantity: number;
}

export interface EventSetupPlan {
  tiers: PlannedTier[];
}

const refuse = (message: string): BadRequestException =>
  new BadRequestException({ message: [message] });

/** The event's ticket capacity: the typed one, else the venue's (spec 007 FR-019). */
export function eventCapacity(input: SetupInput, venue: SetupVenue): number {
  return input.totalTicketCapacity ?? venue.seatingCapacity;
}

/**
 * R4 steps 4 and 5, pure: each ticket type in the order sent, then their total. Throws the first
 * refusal; never throws for a request without `tiers`. `capacity` is the event's, from
 * `eventCapacity`: `createLocked` passes the one it already checked, and left out it is worked out
 * here.
 */
export function planEventSetup(
  input: SetupInput,
  venue: SetupVenue,
  capacity: number = eventCapacity(input, venue),
): EventSetupPlan {
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

    if (tier.quantity === undefined) {
      throw refuse(`${path}.quantity is required for a tier`);
    }
    planned.push({ name, price: tier.price, quantity: tier.quantity });
  }

  // R4 step 5: the typed quantities within the event's capacity.
  if (planned.length > 0) {
    const tierTotal = planned.reduce((n, t) => n + t.quantity, 0);
    if (tierTotal > capacity) {
      throw conflict(
        'CAPACITY_EXCEEDED',
        `${input.name} has ${capacity} tickets, but its ticket types add up to ${tierTotal}.`,
        { field: 'tiers', totalTicketCapacity: capacity, tierTotal },
      );
    }
  }

  return { tiers: planned };
}

/**
 * R4 step 6, after the event row: each ticket type in order. Inside the scheduling transaction, so
 * a failure here leaves nothing (FR-003).
 */
export async function writeEventSetup(
  tx: Prisma.TransactionClient,
  eventId: string,
  plan: EventSetupPlan,
): Promise<void> {
  for (const t of plan.tiers) {
    await tx.ticketTier.create({
      data: { eventId, name: t.name, price: t.price, quantity: t.quantity },
      select: { id: true },
    });
  }
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

/** Sold-ticket counts the planner needs; gathered under the event lock. */
export interface UpdateSetupCounts {
  tierlessSold: number;
  soldByTier: Map<string, number>;
  ordersByTier: Map<string, number>;
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
  existingTiers: ExistingSetupTier[];
  counts: UpdateSetupCounts;
  venue: SetupVenue;
  /** The event's ticket capacity in force after this update's detail checks. */
  capacity: number;
}

/**
 * Spec 035 (research R8): the complete new set of ticket types for an update, checked before the
 * first write. Ids, sold-ticket rules, then the same shape checks as `planEventSetup`.
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

  const planned = planEventSetup(input, ctx.venue, ctx.capacity);
  const withIds: PlannedUpdateTier[] = planned.tiers.map((t, i) => ({
    ...t,
    id: input.tiers![i]!.id,
  }));

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

  return { tiers: withIds, removed };
}

/**
 * Spec 035 (research R8): apply a planned update inside the event's update transaction.
 */
export async function writeEventUpdate(
  tx: Prisma.TransactionClient,
  eventId: string,
  plan: EventUpdatePlan,
): Promise<void> {
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
  for (const t of plan.tiers) {
    if (t.id) {
      await tx.ticketTier.update({
        where: { id: t.id },
        data: { name: t.name, price: t.price, quantity: t.quantity },
      });
    } else {
      await tx.ticketTier.create({
        data: { eventId, name: t.name, price: t.price, quantity: t.quantity },
        select: { id: true },
      });
    }
  }
}
