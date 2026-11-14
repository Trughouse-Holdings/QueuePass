import {
  CHECK_IN_RETENTION_DAYS,
  DEFAULT_TIME_ZONE,
  formatEventDate,
  formatEventEnd,
  formatEventTime,
  zoneName,
  type Location,
  type TimeZoneSource,
  formatDoorsOpen,
} from '@queuepass/shared';

/**
 * An event time in its venue's zone, always with its date and the zone's abbreviation (spec 002
 * FR-031; spec 020 FR-021, research R12): "Oct 1, 2026, 7:00 PM EDT", whatever the admin's own
 * zone. A response without a zone is read as `DEFAULT_TIME_ZONE` (contract `Location`).
 */
export const when = (iso: string, timeZone?: string | null): string =>
  formatEventTime(iso, timeZone || DEFAULT_TIME_ZONE);

/** An event's end next to its start: the time, or the date and time when the date differs. */
export const until = (start: string, end: string, timeZone?: string | null): string =>
  formatEventEnd(start, end, timeZone || DEFAULT_TIME_ZONE);

/**
 * A seat as admins and customers read it (spec 007 FR-011), by its labels as sold (spec 038
 * FR-026): "Section 115, Row F, Seat 7".
 */
export const seatLabel = (s: { section: string; rowLabel: string; seatLabel: string }): string =>
  `Section ${s.section}, Row ${s.rowLabel}, Seat ${s.seatLabel}`;

/** Spec 020 research R14: how a venue's zone was set, in words. */
export const SOURCE_TEXT: Record<TimeZoneSource, string> = {
  ADDRESS: 'from the address',
  STATE: 'from the state',
  ADMIN: 'chosen by an admin',
  DEFAULT: 'the default',
};

/** "Eastern Time, from the address" (spec 020 FR-024). */
export const venueZone = (v: Pick<Location, 'timeZone' | 'timeZoneSource'>): string =>
  `${zoneName(v.timeZone ?? DEFAULT_TIME_ZONE)}, ${SOURCE_TEXT[v.timeZoneSource ?? 'DEFAULT']}`;

/**
 * Spec 025 FR-021 (research R9): an event's doors-open time next to its start, in its venue's
 * zone: "5:30 PM EST" on the start's local date, "Nov 19, 2026, 11:30 PM EST" otherwise.
 */
export const doorsOpen = (
  startsAt: string,
  doorsOpenAt: string,
  timeZone?: string | null,
): string => formatDoorsOpen(startsAt, doorsOpenAt, timeZone || DEFAULT_TIME_ZONE);

/**
 * Spec 030 FR-001 (research R6): an event is past from the instant `now` reaches its end
 * (half-open), whatever its status.
 */
export const hasEnded = (endsAt: string, now: number): boolean => Date.parse(endsAt) <= now;

/**
 * Spec 032 FR-010, FR-011 (research R7): "Check-in details removed on Nov 9, 2026 (kept for 7 days
 * after the event).", the date in the venue's zone, the days from `CHECK_IN_RETENTION_DAYS`.
 */
export const removedNote = (removedAt: string, timeZone?: string | null): string =>
  `Check-in details removed on ${formatEventDate(removedAt, timeZone || DEFAULT_TIME_ZONE)} ` +
  `(kept for ${CHECK_IN_RETENTION_DAYS} days after the event).`;

/** Spec 032 FR-011 (research R7): the short form beside a count on Reports. */
export const removedShort = (removedAt: string, timeZone?: string | null): string =>
  `Details removed ${formatEventDate(removedAt, timeZone || DEFAULT_TIME_ZONE)}`;
