import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOORS_BEFORE_START_MINUTES,
  DOORS_OPEN_MAX_BEFORE_START_MINUTES,
  ENTRY_OPENS_BEFORE_DOORS_MINUTES,
  doorsOpenProblem,
  doorsOpenRangeMessage,
} from '../src/event';
import { formatDoorsOpen } from '../src/time-zone';

/**
 * Spec 025 research R2, R9 (T002): the doors-open range, its one message, and how a doors-open
 * time is shown. Every assertion is an exact value, so it holds whatever the process's zone is
 * (`npm run test:tz`).
 */
const MIN = 60_000;
const at = (iso: string, minutes = 0): Date => new Date(Date.parse(iso) + minutes * MIN);

describe('doors-open constants (R2)', () => {
  it('are 60, 360, and 60 minutes', () => {
    expect(DEFAULT_DOORS_BEFORE_START_MINUTES).toBe(60);
    expect(DOORS_OPEN_MAX_BEFORE_START_MINUTES).toBe(360);
    expect(ENTRY_OPENS_BEFORE_DOORS_MINUTES).toBe(60);
  });
});

describe('doorsOpenProblem (FR-004, both ends allowed)', () => {
  const start = '2026-11-21T00:00:00.000Z';

  it('allows doors at the start', () => {
    expect(doorsOpenProblem(start, start)).toBeNull();
  });

  it('allows doors exactly 6 hours before the start', () => {
    expect(doorsOpenProblem(start, at(start, -360))).toBeNull();
  });

  it('refuses 6 hours 1 minute before as TOO_EARLY', () => {
    expect(doorsOpenProblem(start, at(start, -361))).toBe('TOO_EARLY');
  });

  it('refuses 1 minute after the start as AFTER_START', () => {
    expect(doorsOpenProblem(start, at(start, 1))).toBe('AFTER_START');
  });

  it('takes Date and string alike', () => {
    expect(doorsOpenProblem(new Date(start), new Date(start).toISOString())).toBeNull();
  });

  it('measures elapsed time: 6 hours across the 2027-03-14 spring-forward night is allowed', () => {
    // 7:00 AM EDT is 11:00Z; 6 elapsed hours earlier is 05:00Z, 12:00 AM EST: the local clocks
    // read 7 hours apart.
    expect(doorsOpenProblem('2027-03-14T11:00:00Z', '2027-03-14T05:00:00Z')).toBeNull();
    expect(doorsOpenProblem('2027-03-14T11:00:00Z', '2027-03-14T04:59:00Z')).toBe('TOO_EARLY');
  });
});

describe('doorsOpenRangeMessage (R2)', () => {
  it('names the range in the venue zone, the date once when it is one day', () => {
    expect(doorsOpenRangeMessage('2026-11-21T00:00:00Z', 'America/New_York')).toBe(
      'Doors must open no more than 6 hours before the start and not after it: between ' +
        'Nov 20, 2026, 1:00 PM EST and 7:00 PM EST.',
    );
  });

  it('repeats the date when the range crosses midnight', () => {
    // A 3:00 AM EST start on Nov 21 is 08:00Z.
    expect(doorsOpenRangeMessage(new Date('2026-11-21T08:00:00Z'), 'America/New_York')).toBe(
      'Doors must open no more than 6 hours before the start and not after it: between ' +
        'Nov 20, 2026, 9:00 PM EST and Nov 21, 2026, 3:00 AM EST.',
    );
  });

  it('reads in another zone', () => {
    expect(doorsOpenRangeMessage('2026-11-21T01:00:00Z', 'America/Chicago')).toBe(
      'Doors must open no more than 6 hours before the start and not after it: between ' +
        'Nov 20, 2026, 1:00 PM CST and 7:00 PM CST.',
    );
  });
});

describe('formatDoorsOpen (R9, FR-021)', () => {
  it('shows the time alone on the start’s local date', () => {
    expect(
      formatDoorsOpen('2026-11-21T00:00:00Z', '2026-11-20T22:30:00Z', 'America/New_York'),
    ).toBe('5:30 PM EST');
  });

  it('shows the date and time when doors open the day before', () => {
    // A 1:00 AM EST start on Nov 20 (06:00Z), doors at 11:30 PM EST on Nov 19 (04:30Z).
    expect(
      formatDoorsOpen('2026-11-20T06:00:00Z', '2026-11-20T04:30:00Z', 'America/New_York'),
    ).toBe('Nov 19, 2026, 11:30 PM EST');
  });
});
