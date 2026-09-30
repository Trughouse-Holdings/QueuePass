import { describe, it, expect } from 'vitest';
import { usd, when } from '../src/format';

/** Spec 003 FR-006, FR-007; research R5. TZ is pinned to America/New_York in vitest.config.ts. */
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
  it('shows the local date and time', () => {
    const shown = when('2026-12-01T23:00:00.000Z');
    expect(shown).toContain('Dec 1, 2026');
    expect(shown).toContain('6:00');
  });

  it('gives an event crossing midnight its own end date', () => {
    expect(when('2026-12-02T07:00:00.000Z')).toContain('Dec 2, 2026');
  });
});
