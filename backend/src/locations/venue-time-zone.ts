import { HttpException, HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_TIME_ZONE,
  SCHEDULING_BUFFER_MINUTES,
  STATE_TIME_ZONES,
  US_STATES,
  formatEventEnd,
  formatEventTime,
  formatLocalDateTime,
  resolveLocal,
  toLocalDateTime,
  toOffsetDateTime,
  zoneName,
  type TimeZoneSource,
  type UsState,
  type UsTimeZone,
} from '@queuepass/shared';
import type { Place } from '../address/address-geocoder';
import type { PrismaService } from '../prisma/prisma.service';
import { conflict } from '../common/conflict';
import { SchedulingConflictException } from '../events/scheduling-conflict.exception';

/** A venue's zone and how it was set (data-model.md). */
export interface ZoneDecision {
  timeZone: UsTimeZone;
  timeZoneSource: TimeZoneSource;
}

/** The address decided in this request: its state, and the matched place when verified. */
export interface DecidedAddress {
  state: string;
  /** The verified match's place; null when saved anyway, or the match had none (R1). */
  location: Place | null;
}

export interface ZoneQuestion {
  /** `timeZone` sent by the admin (R4). */
  sent?: UsTimeZone;
  /** Undefined when the address is not decided in this request (no change, R7). */
  address?: DecidedAddress;
  /** Demo data only: DEFAULT instead of TIME_ZONE_REQUIRED (R19). */
  fallbackToDefault?: boolean;
}

const stateName = (code: string): string => US_STATES.find((s) => s.code === code)?.name ?? code;

/** `Eastern Time or Central Time`. */
const either = (zones: readonly UsTimeZone[]): string =>
  zones.length <= 2
    ? zones.map(zoneName).join(' or ')
    : `${zones.slice(0, -1).map(zoneName).join(', ')}, or ${zoneName(zones[zones.length - 1])}`;

/** Spec 020 FR-003, research R3: a split state's address saved anyway needs the admin's choice. */
export function timeZoneRequired(state: string, zones: readonly UsTimeZone[]): HttpException {
  return new HttpException(
    {
      error: {
        code: 'TIME_ZONE_REQUIRED',
        message:
          `${stateName(state)} has more than one time zone. Choose this venue's time zone: ` +
          `${either(zones)}.`,
        details: { state, timeZones: [...zones] },
      },
    },
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * Spec 020 research R7 (with R3, R4): the zone decided by this request, or null when it does not
 * touch the zone. In order: a sent zone (ADMIN); a verified match's place with a zone on the list
 * (ADDRESS); the state when it has one zone (STATE); else TIME_ZONE_REQUIRED, or DEFAULT for demo
 * data. Pure, apart from `zoneAt`.
 */
export function decideZone(
  question: ZoneQuestion,
  zoneAt: (latitude: number, longitude: number) => UsTimeZone | null,
): ZoneDecision | null {
  if (question.sent) return { timeZone: question.sent, timeZoneSource: 'ADMIN' };
  const address = question.address;
  if (!address) return null;
  if (address.location) {
    const zone = zoneAt(address.location.latitude, address.location.longitude);
    if (zone) return { timeZone: zone, timeZoneSource: 'ADDRESS' };
  }
  const zones = STATE_TIME_ZONES[address.state as UsState] ?? [];
  if (zones.length === 1) return { timeZone: zones[0], timeZoneSource: 'STATE' };
  if (question.fallbackToDefault) return { timeZone: DEFAULT_TIME_ZONE, timeZoneSource: 'DEFAULT' };
  throw timeZoneRequired(address.state, zones);
}

// ---------------------------------------------------------------- zone change (R8)

/** At most this many events are named in TIME_ZONE_HAS_ORDERS (research R8). */
const MAX_LISTED = 10;

/**
 * Spec 020 FR-010 (research R8, step 1): no zone change once any event of the venue has any
 * order, in any state. Run as a fast check before the address lookup when a zone is sent, and
 * again under the venue lock.
 */
export async function assertNoOrders(
  db: Pick<PrismaService | Prisma.TransactionClient, 'event'>,
  venue: { id: string; name: string },
  timeZone: UsTimeZone,
  proposedTimeZone: UsTimeZone,
): Promise<void> {
  const sold = await db.event.findMany({
    where: { locationId: venue.id, orders: { some: {} } },
    select: { id: true, name: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  if (sold.length === 0) return;
  throw conflict(
    'TIME_ZONE_HAS_ORDERS',
    `Can't change the time zone of ${venue.name}: tickets have been sold for ${sold.length} of ` +
      "its events. No customer's ticket time may move.",
    {
      timeZone,
      proposedTimeZone,
      events: sold.slice(0, MAX_LISTED),
      eventCount: sold.length,
    },
  );
}

/** The instant's local date-time in the zone, to the millisecond (`YYYY-MM-DDTHH:mm:ss.fff`). */
const localOf = (instant: Date, zone: UsTimeZone): string =>
  `${toOffsetDateTime(instant, zone).slice(0, 19)}.${String(instant.getUTCMilliseconds()).padStart(3, '0')}`;

const FIELD_WORD = { startsAt: 'start', endsAt: 'end' } as const;

/**
 * Spec 020 FR-009 to FR-012 (research R8, steps 1 to 4), inside the venue update's transaction,
 * after `lockVenueAndEvents(tx, id, { allStatuses: true })`, converting from the zone read under
 * that lock. Every event (scheduled or cancelled) keeps its local start and end; refused when any
 * event has an order, when a local time is skipped or repeated in the new zone, or when the
 * scheduled events at their new moments break the 60-minute rule. Then the overlap constraint is
 * deferred to commit and every event is moved. The caller writes the venue.
 */
export async function moveEventsToZone(
  tx: Prisma.TransactionClient,
  venue: { id: string; name: string },
  from: UsTimeZone,
  to: UsTimeZone,
): Promise<void> {
  await assertNoOrders(tx, venue, from, to);

  const events = await tx.event.findMany({
    where: { locationId: venue.id },
    select: { id: true, name: true, status: true, startsAt: true, endsAt: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const moved = events.map((e) => {
    const at = (field: 'startsAt' | 'endsAt'): Date => {
      const refuse = (localTime: string, words: string, reason: string): never => {
        throw conflict(
          'EVENT_TIME_NOT_IN_ZONE',
          `Can't change the time zone: ${e.name}'s ${FIELD_WORD[field]}, ` +
            `${formatLocalDateTime(localTime)}, ${words} ${zoneName(to)}.`,
          { event: { id: e.id, name: e.name }, field, localTime, proposedTimeZone: to, reason },
        );
      };
      let local: string;
      let r: ReturnType<typeof resolveLocal>;
      try {
        local = localOf(e[field], from);
        r = resolveLocal(local, to);
      } catch (err) {
        // #88 (review round 3, n1): before 1883 a zone has no whole-minute offset, so a legacy
        // event's time can't be placed; refused like a skipped time, not a 500.
        if (!(err instanceof RangeError)) throw err;
        return refuse(
          toLocalDateTime(e[field], from),
          'is outside the times QueuePass can place in',
          'OUT_OF_RANGE',
        );
      }
      if (r.kind === 'ok') return r.moment.instant;
      return r.kind === 'skipped'
        ? refuse(local.slice(0, 16), "doesn't exist in", 'SKIPPED')
        : refuse(local.slice(0, 16), 'happens twice in', 'REPEATED');
    };
    return { ...e, startsAt: at('startsAt'), endsAt: at('endsAt') };
  });

  // FR-012: the first pair, in start order, whose windows [start - 60 min, end) overlap.
  const scheduled = moved
    .filter((e) => e.status === 'SCHEDULED')
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  const buffer = SCHEDULING_BUFFER_MINUTES * 60_000;
  for (let j = 1; j < scheduled.length; j++) {
    const later = scheduled[j];
    const earlier = scheduled
      .slice(0, j)
      .find((e) => later.startsAt.getTime() - buffer < e.endsAt.getTime());
    if (earlier) {
      throw new SchedulingConflictException(earlier, to, {
        event: later,
        message:
          `Can't change the time zone: '${later.name}' would start at ` +
          `${formatEventTime(later.startsAt, to)}, less than ${SCHEDULING_BUFFER_MINUTES} minutes ` +
          `after '${earlier.name}', committed from ${formatEventTime(earlier.startsAt, to)} to ` +
          `${formatEventEnd(earlier.startsAt, earlier.endsAt, to)}.`,
      });
    }
  }

  // Checked once, at commit: moving one event at a time can overlap another's old window.
  await tx.$executeRaw`SET CONSTRAINTS "event_no_overlap" DEFERRED`;
  for (const e of moved) {
    await tx.event.update({
      where: { id: e.id },
      data: { startsAt: e.startsAt, endsAt: e.endsAt },
    });
  }
}
