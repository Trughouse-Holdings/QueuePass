import type { Cell, ExportTable } from './table';

export const CSV_TYPE = 'text/csv;charset=utf-8';

/** Research R6 (OWASP CSV injection): a text cell a spreadsheet could read as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 (research R9): quoted only when it holds a comma, quote, CR, or LF; quotes doubled. */
const field = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** FR-007: `YYYY-MM-DD HH:MM`, money as its two-decimal string, counts as integers. */
function value(cell: Cell): string {
  switch (cell.kind) {
    case 'text':
      // FR-010: the one place a CSV differs from the page; spreadsheets show the apostrophe.
      return FORMULA_START.test(cell.value) ? `'${cell.value}` : cell.value;
    case 'dateTime':
      return cell.value.replace('T', ' ');
    case 'money':
      return cell.value;
    case 'count':
      return String(cell.value);
  }
}

/**
 * Spec 023 FR-007 (research R9): UTF-8 with a byte-order mark so Excel reads the letters right,
 * one header row, CRLF line ends, and `Exported at` (the made-at time) last on every row.
 */
export function toCsv(table: ExportTable): Blob {
  const lines = [
    [...table.columns.map((c) => c.header), 'Exported at'].map(field).join(','),
    ...table.rows.map((row) => [...row.map(value), table.madeAt].map(field).join(',')),
  ];
  return new Blob(['﻿', lines.map((l) => `${l}\r\n`).join('')], { type: CSV_TYPE });
}
