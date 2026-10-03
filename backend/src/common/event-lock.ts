import { NotFoundException } from '@nestjs/common';
import type { EventStatus, Prisma } from '@prisma/client';

export interface LockedEvent {
  id: string;
  name: string;
  totalTicketCapacity: number;
  basePrice: Prisma.Decimal;
  status: EventStatus;
  /** Spec 006 FR-014: sales close at this instant. */
  startsAt: Date;
  /** Spec 007: whether the event sells seats, and the venue whose layout it uses. */
  reservedSeating: boolean;
  locationId: string;
}

/**
 * Locks one event row for the rest of the transaction (`SELECT … FOR UPDATE`).
 *
 * Every write that can change an event's ticket allocation or availability takes this lock
 * first: tier writes and capacity edits (spec 004 research R2), and orders and cancellation
 * (spec 005 research R2, R4). Writers for the same event therefore run one at a time, so rules
 * that sum across rows, which no CHECK constraint can express, still hold under concurrency
 * (Constitution IV). Writers for different events never wait for each other.
 */
export async function lockEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<LockedEvent> {
  const rows = await tx.$queryRaw<LockedEvent[]>`
    SELECT "id", "name", "totalTicketCapacity", "basePrice", "status", "startsAt",
           "reservedSeating", "locationId"
    FROM "Event" WHERE "id" = ${eventId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException(`No event exists with id ${eventId}.`);
  return rows[0];
}

/** Interactive transactions here can wait on the event lock, so allow longer than the default. */
export const LOCKING_TX = { maxWait: 10_000, timeout: 15_000 } as const;

/** Valid (unvoided) tickets sold for an event, or for one tier of it. */
export function ticketsSold(
  tx: Prisma.TransactionClient,
  where: { eventId: string; tierId?: string | null },
): Promise<number> {
  return tx.ticket.count({ where: { ...where, status: 'VALID' } });
}
