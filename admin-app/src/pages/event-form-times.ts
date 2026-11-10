/**
 * Spec 036: helpers for doors-open modes and for joining a date and a time (research R1, R2, R4,
 * R5). The form still sends doorsOpenAt; nothing here is stored on the event.
 */
import {
  DEFAULT_DOORS_BEFORE_START_MINUTES,
  formatTimeOfDay,
  type InstantLike,
} from '@queuepass/shared';

export const DOORS_OFFSET_STEP_MINUTES = 15;
export const DOORS_OFFSET_MAX_MINUTES = 6 * 60;
export const DEFAULT_DOORS_OFFSET_MINUTES = DEFAULT_DOORS_BEFORE_START_MINUTES;

export type DoorsMode = 'before' | 'at-time';

/** Every listed length, 0 through 6 hours in 15-minute steps. */
export function doorsOffsetMinutesList(): number[] {
  const out: number[] = [];
  for (let m = 0; m <= DOORS_OFFSET_MAX_MINUTES; m += DOORS_OFFSET_STEP_MINUTES) out.push(m);
  return out;
}

/** "At the start", "1 hour before", "1 hour 30 minutes before", "6 hours before". */
export function doorsOffsetLabel(minutes: number): string {
  if (minutes === 0) return 'At the start';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours === 1) parts.push('1 hour');
  else if (hours > 1) parts.push(`${hours} hours`);
  if (rest > 0) parts.push(`${rest} minutes`);
  return `${parts.join(' ')} before`;
}

export function isExactDoorsOffsetMinutes(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= DOORS_OFFSET_MAX_MINUTES &&
    minutes % DOORS_OFFSET_STEP_MINUTES === 0
  );
}

/** Edit-form default: a 15-minute step in range opens in "Before the start". */
export function doorsModeForStoredGapMs(gapMs: number): DoorsMode {
  if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs % 60_000 !== 0) return 'at-time';
  return isExactDoorsOffsetMinutes(gapMs / 60_000) ? 'before' : 'at-time';
}

export function splitLocalDateTime(value: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const cut = value.indexOf('T');
  if (cut === -1) return { date: value, time: '' };
  return { date: value.slice(0, cut), time: value.slice(cut + 1, cut + 6) };
}

/** Empty unless both the date and the time are present. Time is kept to the minute. */
export function joinLocalDateTime(date: string, time: string): string {
  if (!date || !time) return '';
  return `${date}T${time.slice(0, 5)}`;
}

/** The start instant minus N elapsed minutes. */
export function doorsInstantBeforeStart(start: InstantLike, minutes: number): Date {
  const at = start instanceof Date ? start : new Date(start);
  return new Date(at.getTime() - minutes * 60_000);
}

/** "Doors open at 6:00 PM EDT" once the start names one moment. */
export function doorsOpenAtPreview(instant: InstantLike, zone: string): string {
  return `Doors open at ${formatTimeOfDay(instant, zone)}`;
}

export const doorsOffsetOptions = (): { minutes: number; label: string }[] =>
  doorsOffsetMinutesList().map((minutes) => ({ minutes, label: doorsOffsetLabel(minutes) }));
