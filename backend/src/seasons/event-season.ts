import type { HttpException } from '@nestjs/common';
import type { Prisma, SeasonStatus } from '@prisma/client';
import { formatEventTime } from '@queuepass/shared';
import { conflict } from '../common/conflict';

/** The Season an event belongs to, as the event and ticket type writes read it (research R9). */
export interface EventSeason {
  id: string;
  name: string;
  status: SeasonStatus;
  layoutId: string | null;
  salesEndAt: Date;
  /** General admission: the ticket type names the Season prices. */
  pricedNames: string[];
}

/**
 * Spec 041 research R2, R9: an event write reads its Season under its own event lock, never
 * locking the Season; a Season write that adds the event holds the same event lock, so the two
 * serialize. `null` when the event is in no Season.
 */
export async function seasonOfEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<EventSeason | null> {
  const link = await tx.seasonEvent.findUnique({
    where: { eventId },
    select: {
      season: {
        select: {
          id: true,
          name: true,
          status: true,
          layoutId: true,
          salesEndAt: true,
          prices: { select: { tierName: true } },
        },
      },
    },
  });
  if (!link) return null;
  const { prices, ...season } = link.season;
  return {
    ...season,
    pricedNames: prices.map((p) => p.tierName).filter((n): n is string => n !== null),
  };
}

/** A Season not cancelled holds its events' venue, layout, start and priced names (FR-007). */
export const holdsEvent = (season: EventSeason | null): season is EventSeason =>
  season !== null && season.status !== 'CANCELLED';

/** `409 EVENT_IN_SEASON` naming the Season and the field at fault (R4). */
export function inSeason(season: EventSeason, field: string, message: string): HttpException {
  return conflict('EVENT_IN_SEASON', message, {
    field,
    seasonId: season.id,
    seasonName: season.name,
  });
}

const key = (name: string): string => name.trim().toLowerCase();

/** Whether `name` is a ticket type name the Season prices, ignoring case. */
export const isPricedName = (season: EventSeason, name: string): boolean =>
  season.pricedNames.some((p) => key(p) === key(name));

/** The priced names missing from `names` (a ticket type list after a save), ignoring case. */
export const missingPricedNames = (season: EventSeason, names: readonly string[]): string[] =>
  season.pricedNames.filter((p) => !names.some((n) => key(n) === key(p)));

/** FR-007: the refusal of a start before the Season's sales end, in the venue's zone. */
export function startBeforeSalesEnd(season: EventSeason, eventName: string, zone: string) {
  return inSeason(
    season,
    'startsAt',
    `${eventName} is in ${season.name}, whose pass sales end ${formatEventTime(season.salesEndAt, zone)}; ` +
      'it can’t start before the sales end.',
  );
}
