import { describe, it, expect } from 'vitest';
import { salesTable } from '../../src/export/sales-rows';
import type { Cell } from '../../src/export/table';
import { EXPORT_REPORT } from './fixtures';

/** Spec 023 FR-005 (data-model.md, research R4, R7): one row per event, then Total. */
const t = (value: string): Cell => ({ kind: 'text', value });
const d = (value: string): Cell => ({ kind: 'dateTime', value });
const m = (value: string): Cell => ({ kind: 'money', value });
const n = (value: number): Cell => ({ kind: 'count', value });

describe('salesTable', () => {
  const table = salesTable(EXPORT_REPORT, 'admin2', 'America/New_York');

  it('has the columns of FR-005, in order, with their kinds', () => {
    expect(table.columns.map((c) => [c.header, c.kind])).toEqual([
      ['Event', 'text'],
      ['Venue', 'text'],
      ['Starts', 'dateTime'],
      ['Time zone', 'text'],
      ['Status', 'text'],
      ['Tickets sold', 'count'],
      ['Ticket capacity', 'count'],
      ['Revenue', 'money'],
      ['Checked in', 'count'],
    ]);
  });

  it("has one row per event in the page's order, each in its own zone, then Total", () => {
    expect(table.rows).toEqual([
      [
        t('Season Opener'),
        t('Yum Center'),
        d('2026-11-01T18:00'),
        t('Eastern Time'),
        t('Scheduled'),
        n(25),
        n(100),
        m('1321.50'),
        n(12),
      ],
      [
        t('Winter Gala'),
        t('Freedom Hall'),
        d('2026-12-20T15:00'),
        t('Pacific Time'),
        t('Scheduled'),
        n(50),
        n(200),
        m('3000.00'),
        n(0),
      ],
      [
        t('Rained Out'),
        t('Freedom Hall'),
        d('2026-10-20T19:00'),
        t('Eastern Time'),
        t('Cancelled'),
        n(0),
        n(50),
        m('0.00'),
        n(0),
      ],
      [
        t('Total'),
        t(''),
        d(''),
        t(''),
        t('2 scheduled events'),
        n(75),
        n(300),
        m('4321.50'),
        n(12),
      ],
    ]);
  });

  it('is made at generatedAt, shown in the admin zone with its offset (R7)', () => {
    expect(table.title).toBe('Sales report');
    expect(table.sheetName).toBe('Sales');
    expect(table.madeAt).toBe('2026-10-30T14:05:00-04:00');
    expect(table.subtitle).toEqual([
      'Made at Oct 30, 2026, 2:05 PM EDT',
      'Made by admin2',
      "Each event's time is in its venue's time zone (the Time zone column).",
    ]);
    expect(salesTable(EXPORT_REPORT, 'admin2', 'America/Chicago').madeAt).toBe(
      '2026-10-30T13:05:00-05:00',
    );
  });

  it('says "1 scheduled event" for one, and reads a missing zone as the default (R13b)', () => {
    const one = {
      ...EXPORT_REPORT,
      totals: { ...EXPORT_REPORT.totals, events: 1 },
      events: [{ ...EXPORT_REPORT.events[0], timeZone: undefined }],
    };
    const rows = salesTable(one, 'admin2', 'UTC').rows;
    expect(rows[0][2]).toEqual(d('2026-11-01T18:00'));
    expect(rows[0][3]).toEqual(t('Eastern Time'));
    expect(rows[1][4]).toEqual(t('1 scheduled event'));
  });
});
