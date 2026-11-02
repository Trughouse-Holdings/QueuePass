import type { AttemptClock } from '../../src/attempt-limits/attempt-limits.clock';

/**
 * Spec 026 research R2, R10: the attempt windows' clock in tests. Starts at the real monotonic
 * `performance.now()`, in whole milliseconds, and then stands still, moving only when a test calls
 * `advance(ms)`, so a test can step to a window's boundary to the millisecond. Whole milliseconds
 * keep every sum exact: from a fractional start, five steps adding up to 60 000 could land a hair
 * short of it in floating point. There is no way to move it back, as there is none for the real one.
 */
export class FakeAttemptClock implements AttemptClock {
  private ms = Math.floor(performance.now());

  now(): number {
    return this.ms;
  }

  advance(ms: number): void {
    if (!(ms >= 0)) throw new Error(`FakeAttemptClock only moves forward, not by ${ms} ms`);
    this.ms += ms;
  }
}
