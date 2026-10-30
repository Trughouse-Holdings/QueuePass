import type { Cell, ExportTable } from '../../src/export/table';

/** Spec 023: a small table every writer is tested on (T006–T008). */
const t = (value: string): Cell => ({ kind: 'text', value });

export const SAMPLE: ExportTable = {
  title: 'Attendees: Export Test, Café',
  subtitle: [
    'Made at Oct 30, 2026, 2:05 PM EDT',
    'Made by admin1',
    "Times are in Central Time (the venue's time zone).",
  ],
  madeAt: '2026-10-30T14:05:00-04:00',
  sheetName: 'Attendees',
  columns: [
    { header: 'Order placed', kind: 'dateTime', width: 18 },
    { header: 'Name on tickets', kind: 'text', width: 24 },
    { header: 'Seat', kind: 'text', width: 26 },
    { header: 'Ticket code', kind: 'text', width: 15, nowrap: true },
    { header: 'Checked in', kind: 'dateTime', width: 18 },
    { header: 'Price', kind: 'money', width: 11 },
    { header: 'Tickets', kind: 'count', width: 8 },
  ],
  rows: [
    [
      { kind: 'dateTime', value: '2026-09-30T10:00' },
      t('Jordan Lee'),
      t(''),
      t('ABCDEFGH2345'),
      { kind: 'dateTime', value: '2026-11-01T16:45' },
      { kind: 'money', value: '84.30' },
      { kind: 'count', value: 1200 },
    ],
    [
      { kind: 'dateTime', value: '2026-10-01T20:30' },
      t('=SUM(1,1)'),
      t('Section A, Row 3, Seat 7'),
      t('STUVWXYZ2345'),
      { kind: 'dateTime', value: '' },
      { kind: 'money', value: '1045.00' },
      { kind: 'count', value: 0 },
    ],
    [
      { kind: 'dateTime', value: '2026-10-03T07:00' },
      t('Zoë “Zo” O’Brien'),
      t('Line one\nline two'),
      t('-12'),
      { kind: 'dateTime', value: '' },
      { kind: 'money', value: '0.00' },
      { kind: 'count', value: -1 },
    ],
  ],
};

/** A table of `n` copies of the sample's first row: page-count and size tests. */
export const sampleOf = (n: number): ExportTable => ({
  ...SAMPLE,
  rows: Array.from({ length: n }, () => SAMPLE.rows[0]),
});
