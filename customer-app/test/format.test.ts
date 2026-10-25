import { describe, it, expect } from 'vitest';
import { seatLabel, totalUsd, usd, when } from '../src/format';

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
