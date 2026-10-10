/**
 * An instant in the admin's own time zone, always with its date (spec 002 FR-031), so an event
 * from 22:00 to 02:00 the next day shows two different dates.
 */
export const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A seat as admins and customers read it (spec 007 FR-011): "Section A, Row 3, Seat 7". */
export const seatLabel = (s: { section: string; row: number; seat: number }): string =>
  `Section ${s.section}, Row ${s.row}, Seat ${s.seat}`;
