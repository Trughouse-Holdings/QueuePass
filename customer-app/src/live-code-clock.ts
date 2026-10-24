/**
 * Spec 018 FR-009 (research R3): the Customer app follows the Backend's clock, not the device's.
 * The offset is measured once, around the entry-key request: the Backend's time minus the middle
 * of the request on the device's clock. What remains is at most half the round trip, which the
 * 5 seconds of grace absorb.
 */
export function measureOffset(serverTime: string, sentMs: number, receivedMs: number): number {
  return Date.parse(serverTime) - (sentMs + receivedMs) / 2;
}

/** The Backend's time now, by the device's clock and the measured offset. */
export function serverNow(offset: number): number {
  return Date.now() + offset;
}
