/**
 * Spec 038 (FR-013, research R8, R15): the event form's seats off sale, kept as the selectors the
 * Backend takes and compacted as it compacts them (`getEventSeating`): every whole section as
 * `{sectionId}`, then every whole row as `{sectionId, row}`, then single seats, each in drawing
 * order. Pure, so the tool that edits them can sit on any drawing (the preview now, the shared
 * venue map's `onSeat` from US3).
 */
import type { LayoutDetail, LayoutSectionSeats, OffSaleSelector } from '@queuepass/shared';

/** A seat of a section by its row and seat numbers, "row/seat". */
export const seatKey = (row: number, seat: number): string => `${row}/${seat}`;

/** The seats of one section the selectors put off sale, as seat keys. */
export function offSeatsOf(
  selectors: readonly OffSaleSelector[],
  section: LayoutSectionSeats,
): Set<string> {
  const off = new Set<string>();
  for (const sel of selectors) {
    if (sel.sectionId !== section.sectionId) continue;
    for (const row of section.rows) {
      if (sel.row !== undefined && sel.row !== row.number) continue;
      for (const seat of row.seats) {
        if (sel.seat !== undefined && sel.seat !== seat.number) continue;
        off.add(seatKey(row.number, seat.number));
      }
    }
  }
  return off;
}

/** One section's seats off sale as selectors: the section, else its whole rows and its seats. */
function compactSection(section: LayoutSectionSeats, off: Set<string>): OffSaleSelector[] {
  const { sectionId } = section;
  const all = section.rows.every((r) => r.seats.every((s) => off.has(seatKey(r.number, s.number))));
  if (all && section.rows.length > 0) return [{ sectionId }];
  const out: OffSaleSelector[] = [];
  for (const row of section.rows) {
    const offHere = row.seats.filter((s) => off.has(seatKey(row.number, s.number)));
    if (offHere.length === 0) continue;
    if (offHere.length === row.seats.length) out.push({ sectionId, row: row.number });
    else for (const s of offHere) out.push({ sectionId, row: row.number, seat: s.number });
  }
  return out;
}

/** The selectors in the Backend's compacted order, for the layout's sections in drawing order. */
export function ordered(
  selectors: readonly OffSaleSelector[],
  sectionOrder: readonly string[],
): OffSaleSelector[] {
  const place = new Map(sectionOrder.map((id, i) => [id, i]));
  const kind = (s: OffSaleSelector) => (s.row === undefined ? 0 : s.seat === undefined ? 1 : 2);
  return [...selectors].sort(
    (a, b) =>
      kind(a) - kind(b) ||
      (place.get(a.sectionId) ?? 0) - (place.get(b.sectionId) ?? 0) ||
      (a.row ?? 0) - (b.row ?? 0) ||
      (a.seat ?? 0) - (b.seat ?? 0),
  );
}

/**
 * Replaces one section's selectors by those for `off`, its seats off sale after an edit, keeping
 * every other section's, in compacted order.
 */
export function withSectionOff(
  selectors: readonly OffSaleSelector[],
  section: LayoutSectionSeats,
  off: Set<string>,
  sectionOrder: readonly string[],
): OffSaleSelector[] {
  return ordered(
    [
      ...selectors.filter((s) => s.sectionId !== section.sectionId),
      ...compactSection(section, off),
    ],
    sectionOrder,
  );
}

/** What the price table and the line show: each level's seats on sale, and the totals. */
export interface OffSaleCounts {
  /** Seats off sale by level. */
  offByLevel: Map<string, number>;
  seatsOffSale: number;
  seatsOnSale: number;
  /** Sections whose count by level needs their seats, which are not loaded yet. */
  missing: string[];
}

/**
 * Counts the seats off sale per level. A whole section of one level counts without its seats; a
 * row, a seat, or a section of several levels needs the section's seats (`sections`), and until
 * they are loaded its seats count in the totals but in no level, and it is listed in `missing`.
 */
export function countOffSale(
  layout: Pick<LayoutDetail, 'seatCount' | 'sections'>,
  selectors: readonly OffSaleSelector[],
  sections: Readonly<Record<string, LayoutSectionSeats | undefined>>,
): OffSaleCounts {
  const offByLevel = new Map<string, number>();
  const add = (levelId: string, n: number) =>
    offByLevel.set(levelId, (offByLevel.get(levelId) ?? 0) + n);
  const missing: string[] = [];
  let seatsOffSale = 0;
  for (const summary of layout.sections) {
    const mine = selectors.filter((s) => s.sectionId === summary.id);
    if (mine.length === 0) continue;
    const seats = sections[summary.id];
    if (seats) {
      const off = offSeatsOf(mine, seats);
      for (const row of seats.rows) {
        for (const seat of row.seats) {
          if (off.has(seatKey(row.number, seat.number))) add(seat.levelId, 1);
        }
      }
      seatsOffSale += off.size;
    } else if (mine.some((s) => s.row === undefined)) {
      seatsOffSale += summary.seatCount;
      if (summary.levelIds.length === 1) add(summary.levelIds[0]!, summary.seatCount);
      else missing.push(summary.id);
    } else {
      // Rows or seats of a section not loaded yet: counted once it is.
      missing.push(summary.id);
    }
  }
  return { offByLevel, seatsOffSale, seatsOnSale: layout.seatCount - seatsOffSale, missing };
}
