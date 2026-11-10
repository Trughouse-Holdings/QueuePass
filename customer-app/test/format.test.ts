import { describe, it, expect } from 'vitest';
import { hasEnded, seatLabel, startedNotice, totalUsd, usd, when } from '../src/format';

/**
 * Spec 003 FR-006, FR-007; research R5. Spec 020 (research R12): an event time is shown in its
 * venue's zone with the abbreviation, whatever the device's zone (`npm run test:tz`).
 */
describe('usd', () => {
  it.each([
    ['45.5', '$45.50'],
    ['1200.00', '$1,200.00'],
    ['0', '$0.00'],
    ['7.05', '$7.05'],
    ['12345678.9', '$12,345,678.90'],
  ])('formats %s as %s without going through a float', (price, shown) => {
    expect(usd(price)).toBe(shown);
  });
});

describe('when', () => {
  it("shows the venue's local date and time with the zone's abbreviation", () => {
    expect(when('2026-12-01T23:00:00.000Z', 'America/New_York')).toBe('Dec 1, 2026, 6:00 PM EST');
    expect(when('2026-12-01T23:00:00.000Z', 'America/Phoenix')).toBe('Dec 1, 2026, 4:00 PM MST');
  });

  it('reads a missing zone as Eastern (contract Location)', () => {
    expect(when('2026-12-01T23:00:00.000Z', undefined)).toBe('Dec 1, 2026, 6:00 PM EST');
  });

  it('gives an event crossing midnight its own end date', () => {
    expect(when('2026-12-02T07:00:00.000Z', 'America/New_York')).toBe('Dec 2, 2026, 2:00 AM EST');
  });
});

/** Spec 006 US1-3: the total before confirming, exact to the cent (Constitution, Money). */
describe('totalUsd', () => {
  it.each([
    ['19.99', 3, '$59.97'],
    ['0.10', 3, '$0.30'],
    ['1250.00', 10, '$12,500.00'],
    ['0.00', 4, '$0.00'],
    ['45.5', 2, '$91.00'],
  ])('multiplies %s by %i as %s without going through a float', (price, quantity, shown) => {
    expect(totalUsd(price, quantity)).toBe(shown);
  });
});

/** Spec 007 FR-011: a seat, the same everywhere it is shown. */
describe('seatLabel', () => {
  it('names the section, row, and seat', () => {
    expect(seatLabel({ section: 'A', row: 3, seat: 7 })).toBe('Section A, Row 3, Seat 7');
    expect(seatLabel({ section: 'Floor', row: 12, seat: 140 })).toBe(
      'Section Floor, Row 12, Seat 140',
    );
  });
});

/** Spec 030 FR-001 (research R6): an event is past from the instant its end is reached. */
describe('hasEnded', () => {
  const END = '2026-11-10T03:00:00.000Z';
  const end = Date.parse(END);

  it('is false one millisecond before the end', () => {
    expect(hasEnded(END, end - 1)).toBe(false);
  });

  it('is true at the end exactly, and after', () => {
    expect(hasEnded(END, end)).toBe(true);
    expect(hasEnded(END, end + 60_000)).toBe(true);
  });
});

/**
 * Spec 034 FR-008 to FR-010, FR-012 (research R4, R5): one helper for the notice on the panel and
 * the confirmation, times in the venue's zone, each alone on the reference instant's local date.
 */
describe('startedNotice', () => {
  // Nov 20, 2026, 7:00 PM to 10:00 PM EST.
  const START = '2026-11-21T00:00:00.000Z';
  const END = '2026-11-21T03:00:00.000Z';
  const AT = '2026-11-21T00:30:00.000Z';

  it('says both sentences while the customer can buy', () => {
    expect(startedNotice(START, END, 'America/New_York', AT, 'buy')).toBe(
      'This event has already started (began at 7:00 PM EST). You can still buy tickets until it ends at 10:00 PM EST.',
    );
  });

  it('says only the first sentence when the customer cannot buy', () => {
    expect(startedNotice(START, END, 'America/New_York', AT, 'first')).toBe(
      'This event has already started (began at 7:00 PM EST).',
    );
  });

  it('says how long the tickets admit on the confirmation', () => {
    expect(startedNotice(START, END, 'America/New_York', AT, 'admit')).toBe(
      'This event has already started (began at 7:00 PM EST). Your tickets admit you until it ends at 10:00 PM EST.',
    );
  });

  it("dates an end on another local date than the reference instant's", () => {
    const pastMidnight = '2026-11-21T06:00:00.000Z'; // Nov 21, 1:00 AM EST
    expect(startedNotice(START, pastMidnight, 'America/New_York', AT, 'buy')).toBe(
      'This event has already started (began at 7:00 PM EST). You can still buy tickets until it ends at Nov 21, 2026, 1:00 AM EST.',
    );
  });

  it("dates a start on another local date, once the venue's midnight has passed", () => {
    const afterMidnight = '2026-11-21T05:30:00.000Z'; // Nov 21, 12:30 AM EST
    expect(
      startedNotice(START, '2026-11-21T06:00:00.000Z', 'America/New_York', afterMidnight, 'first'),
    ).toBe('This event has already started (began at Nov 20, 2026, 7:00 PM EST).');
  });

  it("uses the venue's zone, and Eastern when none is given", () => {
    expect(startedNotice(START, END, 'America/Phoenix', AT, 'first')).toBe(
      'This event has already started (began at 5:00 PM MST).',
    );
    expect(startedNotice(START, END, null, AT, 'first')).toBe(
      'This event has already started (began at 7:00 PM EST).',
    );
  });
});
