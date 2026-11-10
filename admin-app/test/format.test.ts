import { describe, it, expect } from 'vitest';
import { hasEnded } from '../src/format';

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
