import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Locks a venue row and then every scheduled event at the venue, in id order, for the rest of
 * the transaction (spec 007 research R3, R4; spec 013 research R7). Venue writes that can change
 * its capacity (layout saves, venue updates) take this lock, always in this order, so they run
 * one at a time and never deadlock with each other. Nothing locks an event and then a venue.
 */
export async function lockVenueAndEvents(
  tx: Prisma.TransactionClient,
  locationId: string,
): Promise<{ name: string; seatingCapacity: number }> {
  const venues = await tx.$queryRaw<{ name: string; seatingCapacity: number }[]>`
    SELECT "name", "seatingCapacity" FROM "Location" WHERE "id" = ${locationId}::uuid
    FOR UPDATE`;
  if (venues.length === 0) throw new NotFoundException(`No venue exists with id ${locationId}.`);
  await tx.$queryRaw`
    SELECT "id" FROM "Event"
    WHERE "locationId" = ${locationId}::uuid AND "status" = 'SCHEDULED'
    ORDER BY "id" FOR UPDATE`;
  return venues[0];
}
