import type { Cell as XlsxCell, SheetData } from 'write-excel-file/browser';
import type { Cell, ExportTable } from './table';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MONEY_FORMAT = '"$"#,##0.00';
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';

/**
 * Research R4: a spreadsheet date has no zone, and the library writes a `Date` from its UTC
 * value, so the venue's wall-clock parts go into the UTC fields.
 */
function wallClock(local: string): Date {
  const [date, time] = local.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

/** FR-008, FR-010: typed cells; text is always a string cell, never a formula. */
function cell(c: Cell): XlsxCell {
  switch (c.kind) {
    case 'text':
      return c.value === '' ? null : { value: c.value, type: String };
    case 'dateTime':
      return c.value === '' ? null : { value: wallClock(c.value), type: Date, format: DATE_FORMAT };
    case 'money':
      // R5: at most two decimals and far below 2^53 cents, so the number shown is exact.
      return { value: Number(c.value), type: Number, format: MONEY_FORMAT };
    case 'count':
      return { value: c.value, type: Number };
  }
}

/**
 * Spec 023 FR-008 (research R2, R4, R5): the table with a frozen bold header row, then an
 * About sheet saying what the file is, when and by whom it was made, and the zone note.
 * The library loads on first use only.
 */
export async function toXlsx(table: ExportTable): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data: SheetData = [
    table.columns.map((c) => ({ value: c.header, type: String, fontWeight: 'bold' as const })),
    ...table.rows.map((row) => row.map(cell)),
  ];
  const about: SheetData = [
    [{ value: table.title, type: String, fontWeight: 'bold' as const }],
    ...table.subtitle.map((line) => [{ value: line, type: String }]),
    [{ value: `Exported at ${table.madeAt}`, type: String }],
  ];
  const blob = await writeXlsxFile([
    {
      sheet: table.sheetName,
      data,
      columns: table.columns.map((c) => ({ width: c.width })),
      stickyRowsCount: 1,
    },
    { sheet: 'About', data: about, columns: [{ width: 80 }] },
  ]).toBlob();
  return blob.type === XLSX_TYPE ? blob : new Blob([blob], { type: XLSX_TYPE });
}
