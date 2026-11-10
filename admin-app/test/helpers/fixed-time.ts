import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Before every fixed-date fixture's end (the earliest, `fixtures/events.json`'s Season Opener,
 * ends 2026-10-02T01:00Z), so no fixture is past whatever day the tests run.
 */
export const FIXTURE_NOW = Date.parse('2026-09-25T12:00:00.000Z');

/**
 * Spec 030 (research R10, tasks T011): the pages that mark past events Ended decide it from the
 * time, so a test rendering them with fixed-date fixtures fixes the time first, as
 * `customer-app/test/add-to-calendar.test.tsx` does. Only `Date` is faked; timers run as usual.
 */
export function fixTimeBeforeFixtures(now = FIXTURE_NOW): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
