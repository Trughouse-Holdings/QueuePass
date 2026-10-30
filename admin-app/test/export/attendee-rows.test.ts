import { describe, it, expect } from 'vitest';
import { attendeeTable } from '../../src/export/attendee-rows';
import type { Cell } from '../../src/export/table';
import { CHICAGO_EVENT, EXPORT_ORDERS } from './fixtures';

/** Spec 023 FR-004 (data-model.md, research R4, R7, R13a, R13b): one row per ticket. */
const t = (value: string): Cell => ({ kind: 'text', value });
const d = (value: string): Cell => ({ kind: 'dateTime', value });
const m = (value: string): Cell => ({ kind: 'money', value });

const MADE_AT = '2026-10-30T18:05:00.000Z';
const table = () =>
  attendeeTable(CHICAGO_EVENT, EXPORT_ORDERS, MADE_AT, 'admin1', 'America/New_York');

describe('attendeeTable', () => {
  it('has the columns of FR-004, in order, with their kinds', () => {
    expect(table().columns.map((c) => [c.header, c.kind])).toEqual([
      ['Order placed', 'dateTime'],
      ['Customer', 'text'],
      ['Name on tickets', 'text'],
      ['Tier', 'text'],
      ['Seat', 'text'],
      ['Ticket code', 'text'],
      ['Ticket status', 'text'],
      ['Checked in', 'dateTime'],
      ['Order status', 'text'],
      ['Price', 'money'],
      ['Order', 'text'],
    ]);
  });

  it('has one row per ticket, orders in the page order, times in the venue zone', () => {
    expect(table().rows).toEqual([
      [
        d('2026-09-30T10:00'),
        t('customer3'),
        t('Jordan Lee'),
        t('VIP'),
        t(''),
        t('ABCDEFGH2345'),
        t('Valid'),
        d('2026-11-01T16:45'),
        t('Confirmed'),
        m('84.30'),
        t('AAAAAAAA'),
      ],
      [
        d('2026-09-30T10:00'),
        t('customer3'),
        t('Jordan Lee'),
        t('VIP'),
        t(''),
        t('JKLMNPQR6789'),
        t('Valid'),
        d(''),
        t('Confirmed'),
        m('84.30'),
        t('AAAAAAAA'),
      ],
      [
        d('2026-10-01T20:30'),
        t('customer2'),
        t('=SUM(1,1)'),
        t('General admission'),
        t(''),
        t('STUVWXYZ2345'),
        t('Valid'),
        d(''),
        t('Confirmed'),
        m('45.00'),
        t('BBBBBBBB'),
      ],
      [
        d('2026-10-03T07:00'),
        t('customer3'),
        t('Zoë O’Brien'),
        t('Floor'),
        t('Section A, Row 3, Seat 7'),
        t('MNPQRSTU2345'),
        t('Valid'),
        d(''),
        t('Confirmed'),
        m('60.00'),
        t('CCCCCCCC'),
      ],
      [
        d('2026-10-04T07:00'),
        t('customer1'),
        t('No name on ticket'),
        t('General'),
        t(''),
        t('VWXYZ2345678'),
        t('Void'),
        // R13b: a void ticket's check-in stays empty, as the page shows only "(void)".
        d(''),
        t('Refunded'),
        m('45.00'),
        t('DDDDDDDD'),
      ],
    ]);
  });

  it("prices add up to the page's order totals", () => {
    const cents = table().rows.reduce(
      (sum, row) => sum + Math.round(Number((row[9] as { value: string }).value) * 100),
      0,
    );
    const totals = EXPORT_ORDERS.reduce(
      (sum, o) => sum + Math.round(Number(o.totalPrice) * 100),
      0,
    );
    expect(cents).toBe(totals);
  });

  it('names the event, when and by whom it was made, and the zone', () => {
    const t = table();
    expect(t.title).toBe('Attendees: Export Test, Café');
    expect(t.sheetName).toBe('Attendees');
    expect(t.madeAt).toBe('2026-10-30T14:05:00-04:00');
    expect(t.subtitle).toEqual([
      'Made at Oct 30, 2026, 2:05 PM EDT',
      'Made by admin1',
      "Times are in Central Time (the venue's time zone).",
    ]);
  });

  it('states the made-at time in the given admin zone (R7)', () => {
    const t = attendeeTable(CHICAGO_EVENT, [], MADE_AT, 'admin1', 'America/Los_Angeles');
    expect(t.madeAt).toBe('2026-10-30T11:05:00-07:00');
    expect(t.subtitle[0]).toBe('Made at Oct 30, 2026, 11:05 AM PDT');
    expect(t.rows).toEqual([]);
  });

  it('reads a venue without a zone as the default zone (R13b)', () => {
    const event = {
      ...CHICAGO_EVENT,
      location: { ...CHICAGO_EVENT.location, timeZone: undefined },
    };
    const t = attendeeTable(event, EXPORT_ORDERS.slice(0, 1), MADE_AT, 'admin1', 'UTC');
    expect(t.rows[0][0]).toEqual(d('2026-09-30T11:00'));
    expect(t.subtitle[2]).toBe("Times are in Eastern Time (the venue's time zone).");
  });
});
