import {
  DEFAULT_TIME_ZONE,
  formatEventEnd,
  formatEventTime,
  zoneName,
  type Location,
  type TimeZoneSource,
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

/** A seat as admins and customers read it (spec 007 FR-011): "Section A, Row 3, Seat 7". */
export const seatLabel = (s: { section: string; row: number; seat: number }): string =>
  `Section ${s.section}, Row ${s.row}, Seat ${s.seat}`;

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
