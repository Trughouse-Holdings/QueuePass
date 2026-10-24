import type { Clock } from '../../src/common/clock';

/**
 * Spec 018 research R3: the Backend's clock in tests. Real time until `set(ms)` fixes it to a
 * millisecond, so a test can hit each live-code window boundary exactly (SC-001). Every test file
 * that calls `set` calls `useRealTime()` in its `afterEach`.
 */
export class FakeClock implements Clock {
  private fixed: number | undefined;

  now(): number {
    return this.fixed ?? Date.now();
  }

  set(ms: number): void {
    this.fixed = ms;
  }

  useRealTime(): void {
    this.fixed = undefined;
  }
}
