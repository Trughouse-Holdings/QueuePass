/**
 * Spec 018 research R3: the Backend's clock for live codes, injectable so tests can place it on
 * the exact millisecond of a window boundary (SC-001). The entry window stays on the database's
 * `now()` (spec 017 research R5); this clock decides which live-code window is current and, from
 * spec 030 (research R2), which events the event list counts as past.
 */
export interface Clock {
  /** Unix milliseconds. */
  now(): number;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => Date.now() };
