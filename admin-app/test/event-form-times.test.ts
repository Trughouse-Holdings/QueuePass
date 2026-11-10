import { describe, expect, it } from 'vitest';
import { toOffsetDateTime } from '@queuepass/shared';
import {
  DEFAULT_DOORS_OFFSET_MINUTES,
  doorsInstantBeforeStart,
  doorsModeForStoredGapMs,
  doorsOffsetLabel,
  doorsOffsetMinutesList,
  doorsOpenAtPreview,
  isExactDoorsOffsetMinutes,
  joinLocalDateTime,
  splitLocalDateTime,
} from '../src/pages/event-form-times';

describe('doors offset list (036 FR-003)', () => {
  it('is every 15 minutes from 0 to 6 hours, with the default 1 hour on the list', () => {
    const list = doorsOffsetMinutesList();
    expect(list[0]).toBe(0);
    expect(list[list.length - 1]).toBe(360);
    expect(list).toHaveLength(25);
    expect(list).toContain(DEFAULT_DOORS_OFFSET_MINUTES);
    expect(list).toContain(90);
  });

  it('names At the start, 1 hour before, 1 hour 30 minutes before, and 6 hours before', () => {
    expect(doorsOffsetLabel(0)).toBe('At the start');
    expect(doorsOffsetLabel(15)).toBe('15 minutes before');
    expect(doorsOffsetLabel(60)).toBe('1 hour before');
    expect(doorsOffsetLabel(90)).toBe('1 hour 30 minutes before');
    expect(doorsOffsetLabel(135)).toBe('2 hours 15 minutes before');
    expect(doorsOffsetLabel(360)).toBe('6 hours before');
  });
});

describe('edit mode from a stored gap (036 FR-005)', () => {
  it('uses Before the start for a 90-minute gap and At a set time for 10 minutes', () => {
    expect(doorsModeForStoredGapMs(90 * 60_000)).toBe('before');
    expect(isExactDoorsOffsetMinutes(90)).toBe(true);
    expect(doorsModeForStoredGapMs(10 * 60_000)).toBe('at-time');
    expect(doorsModeForStoredGapMs(90 * 60_000 + 1)).toBe('at-time');
    expect(doorsModeForStoredGapMs(-60_000)).toBe('at-time');
  });
});

describe('elapsed time, not wall-clock hours (036 FR-009)', () => {
  it('two hours before 3:30 AM after the spring-forward is 12:30 AM, not 1:30 AM', () => {
    // 2027-03-14, America/New_York: 02:00 EST becomes 03:00 EDT.
    const start = new Date('2027-03-14T07:30:00.000Z'); // 3:30 AM EDT
    const doors = doorsInstantBeforeStart(start, 120);
    expect(toOffsetDateTime(doors, 'America/New_York')).toBe('2027-03-14T00:30:00-05:00');
    expect(doorsOpenAtPreview(doors, 'America/New_York')).toBe('Doors open at 12:30 AM EST');
  });
});

describe('joining a date and a time (036 FR-010)', () => {
  it('splits and joins a local value, and is empty until both parts are present', () => {
    expect(splitLocalDateTime('2026-11-20T19:00')).toEqual({ date: '2026-11-20', time: '19:00' });
    expect(joinLocalDateTime('2026-11-20', '19:00')).toBe('2026-11-20T19:00');
    expect(joinLocalDateTime('2026-11-20', '')).toBe('');
    expect(joinLocalDateTime('', '19:00')).toBe('');
    expect(splitLocalDateTime('')).toEqual({ date: '', time: '' });
    expect(joinLocalDateTime('2026-11-20', '19:00:00')).toBe('2026-11-20T19:00');
  });
});
