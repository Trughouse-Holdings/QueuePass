import { DEFAULT_TIME_ZONE, formatEventTime, formatDoorsOpen } from '@queuepass/shared';

/**
 * An event time in its venue's zone, always with its date (spec 003 FR-006) and the zone's
 * abbreviation (spec 020 FR-021, research R12): "Oct 1, 2026, 7:00 PM EDT", whatever the
 * customer's own zone. A response without a zone is read as `DEFAULT_TIME_ZONE`.
 */
export const when = (iso: string, timeZone?: string | null): string =>
  formatEventTime(iso, timeZone || DEFAULT_TIME_ZONE);

/**
 * A decimal-string price as US dollars (spec 003 FR-007). Built from the string's digits, never
 * through a floating-point number, so no cent is ever lost (Constitution, Money; research R5).
 */
export function usd(price: string): string {
  const [whole, fraction = ''] = price.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/** A whole number with thousands separators. */
export const count = (n: number): string => n.toLocaleString('en-US');

/** A decimal-string price in whole cents, never through a floating-point price. */
export function cents(price: string): number {
  const [whole, fraction = ''] = price.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

/**
 * A decimal-string price times a quantity, as US dollars (spec 006 US1-3). Worked in integer
 * cents from the string's digits, never through a floating-point price (Constitution, Money).
 */
export function totalUsd(price: string, quantity: number): string {
  const total = cents(price) * quantity;
  return usd(`${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`);
}

/** A seat as customers read it (spec 007 FR-011): "Section A, Row 3, Seat 7". */
export const seatLabel = (s: { section: string; row: number; seat: number }): string =>
  `Section ${s.section}, Row ${s.row}, Seat ${s.seat}`;

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
