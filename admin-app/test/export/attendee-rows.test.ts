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
      ['Price level', 'text'],
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
        // Spec 038 R17, FR-026: a carried-over ticket's level is its type's name; the row by its label.
        t('Floor'),
        t('Section A, Row C, Seat 7'),
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
        t(''),
        t('VWXYZ2345678'),
        t('Void'),
        // R13b: a void ticket's check-in stays empty, as the page shows only "(void)".
        d(''),
        t('Refunded'),
        m('45.00'),
        t('DDDDDDDD'),
      ],
      // Spec 038 FR-030 (research R17): a seated order has no tier; each ticket names its level and
      // its own price, as the order has no unit price.
      [
        d('2026-10-07T07:00'),
        t('customer4'),
        t('Sam Park'),
        t(''),
        t('Courtside'),
        t('Section 115, Row D, Seat 2'),
        t('BCDFGHJK2345'),
        t('Valid'),
        d(''),
        t('Confirmed'),
        m('95.00'),
        t('EEEEEEEE'),
      ],
      [
        d('2026-10-07T07:00'),
        t('customer4'),
        t('Sam Park'),
        t(''),
        t('Lower sideline'),
        t('Section 115, Row F, Seat 7'),
        t('LMNPQRST6789'),
        t('Valid'),
        d(''),
        t('Confirmed'),
        m('60.00'),
        t('EEEEEEEE'),
      ],
    ]);
  });

  it("prices each ticket at its own price, whatever the order's unit price (038 FR-030)", () => {
    const seated = { ...EXPORT_ORDERS[4], unitPrice: '77.50' };
    const rows = attendeeTable(CHICAGO_EVENT, [seated], MADE_AT, 'admin1', 'UTC').rows;
    expect(rows.map((r) => r[10])).toEqual([m('95.00'), m('60.00')]);
  });

  it("prices add up to the page's order totals", () => {
    const cents = table().rows.reduce(
      (sum, row) => sum + Math.round(Number((row[10] as { value: string }).value) * 100),
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
    // The type requires the zone (#36 review); the fallback still guards a response without it.
    const event = {
      ...CHICAGO_EVENT,
      location: { ...CHICAGO_EVENT.location, timeZone: undefined as unknown as 'America/New_York' },
    };
    const t = attendeeTable(event, EXPORT_ORDERS.slice(0, 1), MADE_AT, 'admin1', 'UTC');
    expect(t.rows[0][0]).toEqual(d('2026-09-30T11:00'));
    expect(t.subtitle[2]).toBe("Times are in Eastern Time (the venue's time zone).");
  });

  describe('a removed event (spec 032 US3-2; FR-012, research R8)', () => {
    const REMOVED = { ...CHICAGO_EVENT, checkInDetailsRemovedAt: '2026-11-10T03:00:00Z' };
    const SENTENCE = 'Check-in details removed on Nov 9, 2026 (kept for 7 days after the event).';

    it('keeps the Checked in column, empty in every row', () => {
      const t = attendeeTable(REMOVED, EXPORT_ORDERS, MADE_AT, 'admin1', 'America/New_York', 3);
      expect(t.columns[8].header).toBe('Checked in');
      expect(t.rows.length).toBe(table().rows.length);
      for (const row of t.rows) expect(row[8]).toEqual(d(''));
      // Every other cell is as before.
      expect(t.rows.map((r) => [...r.slice(0, 8), ...r.slice(9)])).toEqual(
        table().rows.map((r) => [...r.slice(0, 8), ...r.slice(9)]),
      );
    });

    it('adds the sentence and the kept count to the heading lines', () => {
      const t = attendeeTable(REMOVED, EXPORT_ORDERS, MADE_AT, 'admin1', 'America/New_York', 3);
      expect(t.subtitle).toEqual([
        'Made at Oct 30, 2026, 2:05 PM EDT',
        'Made by admin1',
        SENTENCE,
        '3 tickets were checked in.',
        "Times are in Central Time (the venue's time zone).",
      ]);
    });

    it('says "1 ticket was checked in." for a count of one (review round 1)', () => {
      const t = attendeeTable(REMOVED, EXPORT_ORDERS, MADE_AT, 'admin1', 'America/New_York', 1);
      expect(t.subtitle).toContain('1 ticket was checked in.');
      expect(t.subtitle.join(' ')).not.toContain('tickets were');
    });

    it('adds the sentence only when the count could not be read', () => {
      const t = attendeeTable(REMOVED, EXPORT_ORDERS, MADE_AT, 'admin1', 'America/New_York');
      expect(t.subtitle).toContain(SENTENCE);
      expect(t.subtitle.join(' ')).not.toMatch(/checked in\./);
      expect(t.subtitle).toHaveLength(4);
    });

    it('is as today for an event not removed (US3-3)', () => {
      const kept = { ...CHICAGO_EVENT, checkInDetailsRemovedAt: null };
      expect(attendeeTable(kept, EXPORT_ORDERS, MADE_AT, 'admin1', 'America/New_York', 3)).toEqual(
        table(),
      );
    });
  });
});
