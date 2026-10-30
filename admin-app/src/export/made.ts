import { formatEventTime, toOffsetDateTime, type InstantLike } from '@queuepass/shared';

/** The device's own zone: the admin's zone for made-at times and file names (R7, R8). */
export const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Spec 023 FR-003, research R7: the made-at time with its offset, and the heading lines. */
export function madeLines(
  madeAt: InstantLike,
  madeBy: string,
  adminZone: string,
): { madeAt: string; lines: string[] } {
  return {
    madeAt: toOffsetDateTime(madeAt, adminZone),
    lines: [`Made at ${formatEventTime(madeAt, adminZone)}`, `Made by ${madeBy}`],
  };
}
