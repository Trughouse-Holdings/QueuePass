import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface LockedEvent {
  id: string;
  name: string;
  totalTicketCapacity: number;
}

/**
 * Locks one event row for the rest of the transaction (`SELECT … FOR UPDATE`).
 *
 * Every write that can change an event's ticket allocation takes this lock first: tier writes
 * and capacity edits (spec 004 research R2). Writers for the same event therefore run one at a
 * time, so a rule that sums across rows, which no CHECK constraint can express, still holds
 * under concurrency (Constitution IV). Writers for different events never wait for each other.
 */
export async function lockEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<LockedEvent> {
  const rows = await tx.$queryRaw<LockedEvent[]>`
    SELECT "id", "name", "totalTicketCapacity" FROM "Event" WHERE "id" = ${eventId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException(`No event exists with id ${eventId}.`);
  return rows[0];
}

/** Interactive transactions here can wait on the event lock, so allow longer than the default. */
export const LOCKING_TX = { maxWait: 10_000, timeout: 15_000 } as const;
