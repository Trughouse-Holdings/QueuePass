/**
 * Spec 023 (data-model.md, research R3): the one table model every export is made from. The
 * builders (`attendee-rows.ts`, `sales-rows.ts`) decide every figure; the writers (`csv.ts`,
 * `xlsx.ts`, `pdf.ts`) only format it.
 */
export type Cell =
  | { kind: 'text'; value: string }
  /** The venue's wall-clock time, `YYYY-MM-DDTHH:mm`, or `''` when empty (research R4). */
  | { kind: 'dateTime'; value: string }
  /** A two-decimal amount, `'45.00'`, never a float (research R5). */
  | { kind: 'money'; value: string }
  | { kind: 'count'; value: number };

export interface ExportColumn {
  header: string;
  kind: Cell['kind'];
  /** In characters: the Excel column width. */
  width: number;
  /** PDF only: sized to its content and never wrapped (codes, dates, numbers; research R10). */
  nowrap?: boolean;
}

export interface ExportTable {
  /** `'Attendees: Season Opener'` | `'Sales report'`. */
  title: string;
  /** Made at, made by (`useAuth().username`), and the time-zone note. */
  subtitle: string[];
  /** RFC 3339 with the admin's own offset (research R7). */
  madeAt: string;
  /** `'Attendees'` | `'Sales'`. */
  sheetName: string;
  columns: ExportColumn[];
  rows: Cell[][];
}
