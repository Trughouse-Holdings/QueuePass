/**
 * Spec 018 FR-009 (research R3): the Customer app follows the Backend's clock, not the device's.
 * The offset is measured once, around the entry-key request: the Backend's time minus the middle
 * of the request. What remains is at most half the round trip, which the 5 seconds of grace
 * absorb. Both readings come from `performance.now()`, which only moves forward: a device clock
 * that jumps while the page is open (a time sync when the signal returns, or a manual change)
 * doesn't move the codes.
 */
export function measureOffset(serverTime: string, sentMs: number, receivedMs: number): number {
  return Date.parse(serverTime) - (sentMs + receivedMs) / 2;
}

/** The Backend's time now, in Unix milliseconds, from `performance.now()` and the offset. */
export function serverNow(offset: number): number {
  return performance.now() + offset;
}
