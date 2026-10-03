/**
 * An instant in the customer's own time zone, always with its date (spec 003 FR-006), so an
 * event from 22:00 to 02:00 the next day shows two different dates.
 */
export const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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

/**
 * A decimal-string price times a quantity, as US dollars (spec 006 US1-3). Worked in integer
 * cents from the string's digits, never through a floating-point price (Constitution, Money).
 */
export function totalUsd(price: string, quantity: number): string {
  const [whole, fraction = ''] = price.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  const total = cents * quantity;
  return usd(`${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`);
}

/** A seat as customers read it (spec 007 FR-011): "Section A, Row 3, Seat 7". */
export const seatLabel = (s: { section: string; row: number; seat: number }): string =>
  `Section ${s.section}, Row ${s.row}, Seat ${s.seat}`;
