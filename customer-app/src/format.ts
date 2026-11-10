import {
  DEFAULT_TIME_ZONE,
  formatEventEnd,
  formatEventTime,
  formatDoorsOpen,
  type InstantLike,
} from '@queuepass/shared';

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

/**
 * Spec 034 (research R4, R5): which notice an event in progress gets. `buy` on the Get tickets
 * panel while it offers tickets (FR-008), `first` while it shows a reason it offers none (FR-010),
 * `admit` on the confirmation of an order placed after the start (FR-012).
 */
export type StartedNoticeKind = 'buy' | 'first' | 'admit';

/**
 * Spec 034 FR-008 to FR-010, FR-012: "This event has already started (began at 7:00 PM EST)."
 * and, for `buy` or `admit`, the sentence that follows. Each time is in the venue's zone with its
 * abbreviation, alone on the local date of `at` (when the panel's availability loaded, or the
 * order's `createdAt`) and with its date otherwise (FR-009), by `formatEventEnd` (spec 020).
 */
export function startedNotice(
  startsAt: string,
  endsAt: string,
  timeZone: string | null | undefined,
  at: InstantLike,
  kind: StartedNoticeKind,
): string {
  const zone = timeZone || DEFAULT_TIME_ZONE;
  const first = `This event has already started (began at ${formatEventEnd(at, startsAt, zone)}).`;
  if (kind === 'first') return first;
  const end = formatEventEnd(at, endsAt, zone);
  return kind === 'buy'
    ? `${first} You can still buy tickets until it ends at ${end}.`
    : `${first} Your tickets admit you until it ends at ${end}.`;
}
