import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TimeZoneSource, UsTimeZone } from '@queuepass/shared';

/** The venue row as read under its lock: spec 020 R8 compares and converts from this zone. */
export interface LockedVenue {
  name: string;
  seatingCapacity: number;
  timeZone: UsTimeZone;
  timeZoneSource: TimeZoneSource;
}

/**
 * Locks a venue row and then its events, in id order, for the rest of the transaction (spec 007
 * research R3, R4; spec 013 research R7). Venue writes that can change its capacity (layout saves,
 * venue updates) take this lock, always in this order, so they run one at a time and never
 * deadlock with each other. Nothing locks an event and then a venue: event writes take the venue
 * row FOR SHARE first (`lockVenueShared`, spec 020 research R10).
 *
 * Spec 020 research R8 (review round 2, n5): the venue's `timeZone` and `timeZoneSource` are read
 * here, under the lock, and a zone change uses only them, never a row read before the lock. A
 * venue update passes `{ allStatuses: true }`: it locks every event of the venue, scheduled or
 * cancelled, in one query in id order, because a zone change moves cancelled events too and a
 * cancelled event without orders can be deleted or get an image write concurrently. Layout saves
 * keep the scheduled-only default: only scheduled events sell seats.
 */
export async function lockVenueAndEvents(
  tx: Prisma.TransactionClient,
  locationId: string,
  options: { allStatuses?: boolean } = {},
): Promise<LockedVenue> {
  const venues = await tx.$queryRaw<LockedVenue[]>`
    SELECT "name", "seatingCapacity", "timeZone", "timeZoneSource"::text AS "timeZoneSource"
    FROM "Location" WHERE "id" = ${locationId}::uuid
    FOR UPDATE`;
  if (venues.length === 0) throw new NotFoundException(`No venue exists with id ${locationId}.`);
  if (options.allStatuses) {
    await tx.$queryRaw`
      SELECT "id" FROM "Event" WHERE "locationId" = ${locationId}::uuid
      ORDER BY "id" FOR UPDATE`;
  } else {
    await tx.$queryRaw`
      SELECT "id" FROM "Event"
      WHERE "locationId" = ${locationId}::uuid AND "status" = 'SCHEDULED'
      ORDER BY "id" FOR UPDATE`;
  }
  return venues[0];
}

/**
 * Spec 020 research R10: an event write takes its venue rows FOR SHARE, in id order, before
 * anything else (both venues on a move), so the zone it checks a time against is the zone the
 * event is saved under: a zone change (FOR UPDATE, above) waits for it, or it waits for the zone
 * change. Event writes at one venue still run together. Returns each locked venue's zone by id;
 * a missing venue is simply absent.
 */
export async function lockVenueShared(
  tx: Prisma.TransactionClient,
  locationIds: string[],
): Promise<Map<string, UsTimeZone>> {
  const ids = [...new Set(locationIds)].sort();
  const rows = await tx.$queryRaw<{ id: string; timeZone: UsTimeZone }[]>`
    SELECT "id"::text AS "id", "timeZone" FROM "Location"
    WHERE "id" = ANY(${ids}::uuid[])
    ORDER BY "id" FOR SHARE`;
  return new Map(rows.map((r) => [r.id, r.timeZone]));
}
