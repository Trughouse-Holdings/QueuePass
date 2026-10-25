import { DEFAULT_TIME_ZONE, formatEventTime } from '@queuepass/shared';

/**
 * Spec 017: the same date and seat formatting the other apps use (research R11). Spec 020 FR-021
 * (research R12): every time in the venue's zone of the event it belongs to, with the zone's
 * abbreviation, whatever the booth device's zone; a missing zone reads as `DEFAULT_TIME_ZONE`.
 */
export const when = (iso: string, timeZone?: string | null): string =>
  formatEventTime(iso, timeZone || DEFAULT_TIME_ZONE);

export const seatLabel = (s: { section: string; row: number; seat: number }): string =>
  `Section ${s.section}, Row ${s.row}, Seat ${s.seat}`;
