import { NotFoundException } from '@nestjs/common';
import type { LayoutSource, Prisma } from '@prisma/client';
import { lockVenue, type LockedVenue } from '../common/venue-lock';

/** A layout as read under its lock. */
export interface LockedLayout {
  id: string;
  locationId: string;
  name: string;
  source: LayoutSource;
}

/**
 * Spec 038 research R7: the lock of a write to a new layout (create, import, duplicate): the venue,
 * FOR UPDATE, so layout writes at one venue run one at a time and its `seatingCapacity`, the
 * largest layout's seat count (FR-009), is computed from what is committed.
 */
export function lockVenueForLayouts(
  tx: Prisma.TransactionClient,
  locationId: string,
): Promise<LockedVenue> {
  return lockVenue(tx, locationId);
}

/**
 * Spec 038 research R7: the lock of a write to an existing layout (rename, lines, delete). The venue
 * first, always, FOR UPDATE; then the layout row; then every scheduled event using the layout, in id
 * order. Event saves take the venue FOR SHARE first (`lockVenueShared`), then the event; holds,
 * orders and the sweep lock only the event: so no two of them ever wait on each other in opposite
 * orders. The layout's venue is read before the lock: a layout never moves to another venue.
 * Returns the venue, the layout and the ids of those events.
 */
export async function lockLayout(
  tx: Prisma.TransactionClient,
  layoutId: string,
): Promise<{ venue: LockedVenue; layout: LockedLayout; eventIds: string[] }> {
  const missing = () => new NotFoundException(`No layout exists with id ${layoutId}.`);
  const found = await tx.$queryRaw<{ locationId: string }[]>`
    SELECT "locationId"::text AS "locationId" FROM "Layout" WHERE "id" = ${layoutId}::uuid`;
  if (found.length === 0) throw missing();
  const venue = await lockVenue(tx, found[0].locationId);
  const layouts = await tx.$queryRaw<LockedLayout[]>`
    SELECT "id"::text AS "id", "locationId"::text AS "locationId", "name",
           "source"::text AS "source"
    FROM "Layout" WHERE "id" = ${layoutId}::uuid
    FOR UPDATE`;
  // Deleted between the read and the lock.
  if (layouts.length === 0) throw missing();
  const events = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"::text AS "id" FROM "Event"
    WHERE "layoutId" = ${layoutId}::uuid AND "status" = 'SCHEDULED'
    ORDER BY "id" FOR UPDATE`;
  return { venue, layout: layouts[0], eventIds: events.map((e) => e.id) };
}
