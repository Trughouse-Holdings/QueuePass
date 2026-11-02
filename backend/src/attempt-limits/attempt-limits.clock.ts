/**
 * Spec 026 research R2: the clock the attempt windows are measured on. Monotonic
 * (`performance.now()`), never wall-clock time, so a time correction that sets the Backend's clock
 * back cannot leave recorded attempts "in the future" and keep an account waiting. Separate from
 * the live-code `CLOCK` (spec 018), which is wall-clock time and is provided only inside
 * `EntryModule`; tests replace this one with a `FakeAttemptClock` that only moves forward.
 */
export interface AttemptClock {
  /** Milliseconds on a monotonic clock; only differences between readings mean anything. */
  now(): number;
}

export const ATTEMPT_CLOCK = Symbol('ATTEMPT_CLOCK');

export const monotonicClock: AttemptClock = { now: () => performance.now() };
