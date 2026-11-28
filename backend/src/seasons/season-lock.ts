import { NotFoundException } from '@nestjs/common';
import type { Prisma, SeasonStatus } from '@prisma/client';
import type { UsTimeZone } from '@queuepass/shared';
import { lockVenueShared } from '../common/venue-lock';

/** The Season row as read under its lock. */
export interface LockedSeason {
  id: string;
  name: string;
  locationId: string;
  layoutId: string | null;
  status: SeasonStatus;
}

/**
 * Research R2 (review S8): the Season's venue changed between the read before the transaction and
 * the Season lock. The service rolls back and tries once more, as `updateEvent`'s `VenueMoved`.
 */
export class SeasonVenueMoved extends Error {}

export interface SeasonLocks {
  /** Each locked venue's zone by id. */
  zones: Map<string, UsTimeZone>;
  /** The Season, `null` on a create. */
  season: LockedSeason | null;
  /** The Season's events before this write, in id order (empty on a create). */
  storedEventIds: string[];
}

/**
 * Spec 041 research R2: the lock order of every Season write, in one `LOCKING_TX` transaction:
 * the venue `FOR SHARE` (on an update both the stored and the requested venue, in id order, for
 * the zone its times are checked against), then the Season row `FOR UPDATE` (not on a create),
 * then every event involved, old and new, `FOR UPDATE` in id order. Event writes take the venue
 * FOR SHARE and then their event and never lock a Season; `042`'s pass hold and purchase take the
 * Season FOR SHARE and then its events in id order. So a Season write and an event write
 * serialize on the event row, and a Season write and a pass sale on the Season row.
 *
 * `storedLocationId` is the Season's venue as read before the transaction; if the locked row says
 * otherwise, `SeasonVenueMoved` is thrown. A missing venue is `404`; a missing Season `404`.
 */
export async function lockSeasonWrite(
  tx: Prisma.TransactionClient,
  args: {
    locationId: string;
    storedLocationId?: string;
    seasonId?: string;
    eventIds: readonly string[];
  },
): Promise<SeasonLocks> {
  const venues = [args.locationId, ...(args.storedLocationId ? [args.storedLocationId] : [])];
  const zones = await lockVenueShared(tx, venues);
  if (!zones.has(args.locationId)) {
    throw new NotFoundException(`No venue exists with id ${args.locationId}.`);
  }

  let season: LockedSeason | null = null;
  let storedEventIds: string[] = [];
  if (args.seasonId) {
    const rows = await tx.$queryRaw<LockedSeason[]>`
      SELECT "id"::text AS "id", "name", "locationId"::text AS "locationId",
             "layoutId"::text AS "layoutId", "status"::text AS "status"
      FROM "Season" WHERE "id" = ${args.seasonId}::uuid FOR UPDATE`;
    if (rows.length === 0)
      throw new NotFoundException(`No season exists with id ${args.seasonId}.`);
    season = rows[0];
    if (args.storedLocationId !== undefined && season.locationId !== args.storedLocationId) {
      throw new SeasonVenueMoved();
    }
    const stored = await tx.seasonEvent.findMany({
      where: { seasonId: season.id },
      select: { eventId: true },
    });
    storedEventIds = stored.map((s) => s.eventId).sort();
  }

  const ids = [...new Set([...storedEventIds, ...args.eventIds])].sort();
  if (ids.length > 0) {
    await tx.$queryRaw`
      SELECT "id" FROM "Event" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
  }
  return { zones, season, storedEventIds };
}
