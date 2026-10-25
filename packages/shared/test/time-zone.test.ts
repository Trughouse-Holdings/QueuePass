import { describe, expect, it } from 'vitest';
import { US_STATES } from '../src/location';
import {
  DEFAULT_TIME_ZONE,
  STATE_TIME_ZONES,
  US_TIME_ZONES,
  abbreviationAt,
  formatEventDate,
  formatEventEnd,
  formatLocalDateTime,
  formatLocalTime,
  formatEventTime,
  formatTimeOfDay,
  formatViewerTime,
  isUsTimeZone,
  localDate,
  offsetAt,
  parseOffsetDateTime,
  resolveLocal,
  skippedTimeMessage,
  toLocalDateTime,
  toOffsetDateTime,
  zoneName,
  type UsTimeZone,
} from '../src/time-zone';

/**
 * Spec 020 research R2, R3, R11, R20 (SC-004). Every assertion is an exact value, so it holds
 * whatever the process's own zone is: `npm run test:tz` runs this file under four (T050), and CI
 * reruns it in America/Los_Angeles.
 */

describe('US_TIME_ZONES (R2)', () => {
  it('is exactly the eight zones, in order, with their names', () => {
    expect(US_TIME_ZONES).toEqual([
      { id: 'America/New_York', name: 'Eastern Time' },
      { id: 'America/Chicago', name: 'Central Time' },
      { id: 'America/Denver', name: 'Mountain Time' },
      { id: 'America/Phoenix', name: 'Arizona Time (no daylight saving)' },
      { id: 'America/Los_Angeles', name: 'Pacific Time' },
      { id: 'America/Anchorage', name: 'Alaska Time' },
      { id: 'America/Adak', name: 'Hawaii-Aleutian Time' },
      { id: 'Pacific/Honolulu', name: 'Hawaii Time' },
    ]);
  });

  it('defaults to Eastern Time', () => {
    expect(DEFAULT_TIME_ZONE).toBe('America/New_York');
  });

  it.each(US_TIME_ZONES.map((z) => z.id))('isUsTimeZone accepts %s', (id) => {
    expect(isUsTimeZone(id)).toBe(true);
  });

  it.each(['America/Kentucky/Louisville', 'UTC', '', 'america/new_york', undefined, 5])(
    'isUsTimeZone refuses %s',
    (value) => {
      expect(isUsTimeZone(value)).toBe(false);
    },
  );

  it('names a zone (zoneName)', () => {
    expect(zoneName('America/Phoenix')).toBe('Arizona Time (no daylight saving)');
    expect(zoneName('America/New_York')).toBe('Eastern Time');
  });
});

describe('STATE_TIME_ZONES (R3)', () => {
  const SPLIT: Record<string, UsTimeZone[]> = {
    AK: ['America/Anchorage', 'America/Adak'],
    AZ: ['America/Phoenix', 'America/Denver'],
    FL: ['America/New_York', 'America/Chicago'],
    ID: ['America/Denver', 'America/Los_Angeles'],
    IN: ['America/New_York', 'America/Chicago'],
    KS: ['America/Chicago', 'America/Denver'],
    KY: ['America/New_York', 'America/Chicago'],
    MI: ['America/New_York', 'America/Chicago'],
    NE: ['America/Chicago', 'America/Denver'],
    NV: ['America/Los_Angeles', 'America/Denver'],
    ND: ['America/Chicago', 'America/Denver'],
    OR: ['America/Los_Angeles', 'America/Denver'],
    SD: ['America/Chicago', 'America/Denver'],
    TN: ['America/Chicago', 'America/New_York'],
    TX: ['America/Chicago', 'America/Denver'],
  };

  it("has exactly US_STATES' 51 codes", () => {
    expect(Object.keys(STATE_TIME_ZONES).sort()).toEqual(US_STATES.map((s) => s.code).sort());
  });

  it('lists two zones exactly for the 15 split states, in R3 order', () => {
    const split = Object.entries(STATE_TIME_ZONES).filter(([, zones]) => zones.length > 1);
    expect(Object.fromEntries(split)).toEqual(SPLIT);
  });

  it('gives every other state one zone', () => {
    for (const [state, zones] of Object.entries(STATE_TIME_ZONES)) {
      if (!(state in SPLIT)) expect(zones, state).toHaveLength(1);
    }
    expect(STATE_TIME_ZONES.HI).toEqual(['Pacific/Honolulu']);
    expect(STATE_TIME_ZONES.CA).toEqual(['America/Los_Angeles']);
    expect(STATE_TIME_ZONES.WA).toEqual(['America/Los_Angeles']);
    expect(STATE_TIME_ZONES.CO).toEqual(['America/Denver']);
    expect(STATE_TIME_ZONES.IL).toEqual(['America/Chicago']);
    expect(STATE_TIME_ZONES.OH).toEqual(['America/New_York']);
    expect(STATE_TIME_ZONES.DC).toEqual(['America/New_York']);
  });

  it('uses only zones on US_TIME_ZONES', () => {
    for (const zones of Object.values(STATE_TIME_ZONES)) {
      for (const zone of zones) expect(isUsTimeZone(zone)).toBe(true);
    }
  });
});

/** The minutes of one local day, `YYYY-MM-DDTHH:mm`. */
function minutesOf(date: string): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m++) {
      out.push(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
}

const DAYLIGHT: Record<string, [string, string] | null> = {
  'America/New_York': ['EDT', 'EST'],
  'America/Chicago': ['CDT', 'CST'],
  'America/Denver': ['MDT', 'MST'],
  'America/Phoenix': null,
  'America/Los_Angeles': ['PDT', 'PST'],
  'America/Anchorage': ['AKDT', 'AKST'],
  'Pacific/Honolulu': null,
};

describe.each(Object.keys(DAYLIGHT) as UsTimeZone[])('resolveLocal in %s (SC-004)', (zone) => {
  const abbrs = DAYLIGHT[zone];

  it('round-trips every minute of 2027-03-14, skipping exactly 02:00-02:59 where clocks change', () => {
    for (const local of minutesOf('2027-03-14')) {
      const r = resolveLocal(local, zone);
      const inGap = abbrs !== null && local >= '2027-03-14T02:00' && local <= '2027-03-14T02:59';
      if (inGap) {
        expect(r, local).toEqual({ kind: 'skipped', skippedFrom: '02:00', skippedTo: '03:00' });
      } else {
        expect(r.kind, local).toBe('ok');
        if (r.kind === 'ok') expect(toLocalDateTime(r.moment.instant, zone)).toBe(local);
      }
    }
  });

  it('round-trips every minute of 2027-11-07, repeating exactly 01:00-01:59 where clocks change', () => {
    for (const local of minutesOf('2027-11-07')) {
      const r = resolveLocal(local, zone);
      const repeated = abbrs !== null && local >= '2027-11-07T01:00' && local <= '2027-11-07T01:59';
      if (repeated) {
        expect(r.kind, local).toBe('repeated');
        if (r.kind !== 'repeated') continue;
        expect(r.second.instant.getTime() - r.first.instant.getTime()).toBe(3_600_000);
        expect(r.first.abbreviation).toBe(abbrs[0]);
        expect(r.second.abbreviation).toBe(abbrs[1]);
        expect(toLocalDateTime(r.first.instant, zone)).toBe(local);
        expect(toLocalDateTime(r.second.instant, zone)).toBe(local);
      } else {
        expect(r.kind, local).toBe('ok');
        if (r.kind === 'ok') expect(toLocalDateTime(r.moment.instant, zone)).toBe(local);
      }
    }
  });

  if (abbrs !== null) {
    it.each([
      ['2027-03-14T01:59', 'ok'],
      ['2027-03-14T02:00', 'skipped'],
      ['2027-03-14T02:59', 'skipped'],
      ['2027-03-14T03:00', 'ok'],
      ['2027-11-07T00:59', 'ok'],
      ['2027-11-07T01:00', 'repeated'],
      ['2027-11-07T01:59', 'repeated'],
      ['2027-11-07T02:00', 'ok'],
    ])('names the boundary %s as %s', (local, kind) => {
      expect(resolveLocal(local, zone).kind).toBe(kind);
    });
  } else {
    it('never skips or repeats', () => {
      for (const local of ['2027-03-14T02:30', '2027-11-07T01:30']) {
        expect(resolveLocal(local, zone).kind).toBe('ok');
      }
    });
  }
});

describe('resolveLocal in America/Adak', () => {
  it('skips and repeats with HADT and HAST', () => {
    expect(resolveLocal('2027-03-14T02:30', 'America/Adak')).toEqual({
      kind: 'skipped',
      skippedFrom: '02:00',
      skippedTo: '03:00',
    });
    const r = resolveLocal('2027-11-07T01:30', 'America/Adak');
    expect(r.kind).toBe('repeated');
    if (r.kind === 'repeated') {
      expect([r.first.abbreviation, r.second.abbreviation]).toEqual(['HADT', 'HAST']);
      expect([r.first.offset, r.second.offset]).toEqual(['-09:00', '-10:00']);
    }
  });
});

describe('resolveLocal moments', () => {
  it('gives the instant, offset, and abbreviation', () => {
    expect(resolveLocal('2026-10-01T19:00', 'America/New_York')).toEqual({
      kind: 'ok',
      moment: { instant: new Date('2026-10-01T23:00:00Z'), offset: '-04:00', abbreviation: 'EDT' },
    });
  });

  it('reads seconds and fractions', () => {
    const r = resolveLocal('2026-10-01T19:00:30.250', 'America/New_York');
    expect(r.kind === 'ok' && r.moment.instant.toISOString()).toBe('2026-10-01T23:00:30.250Z');
  });

  it('puts the earlier moment first for a repeated time', () => {
    const r = resolveLocal('2027-11-07T01:30', 'America/New_York');
    expect(r).toEqual({
      kind: 'repeated',
      first: { instant: new Date('2027-11-07T05:30:00Z'), offset: '-04:00', abbreviation: 'EDT' },
      second: { instant: new Date('2027-11-07T06:30:00Z'), offset: '-05:00', abbreviation: 'EST' },
    });
  });

  it.each(['2026-10-01', '2026-10-01 19:00', '2026-13-01T19:00', '2026-02-30T19:00', 'x'])(
    'refuses the malformed local time %s',
    (local) => {
      expect(() => resolveLocal(local, 'America/New_York')).toThrow(RangeError);
    },
  );
});

describe('offsetAt and abbreviationAt (R2 table)', () => {
  const JULY = new Date('2026-07-01T12:00:00Z');
  const DECEMBER = new Date('2026-12-01T12:00:00Z');
  it.each([
    ['America/New_York', -240, 'EDT', -300, 'EST'],
    ['America/Chicago', -300, 'CDT', -360, 'CST'],
    ['America/Denver', -360, 'MDT', -420, 'MST'],
    ['America/Phoenix', -420, 'MST', -420, 'MST'],
    ['America/Los_Angeles', -420, 'PDT', -480, 'PST'],
    ['America/Anchorage', -480, 'AKDT', -540, 'AKST'],
    ['America/Adak', -540, 'HADT', -600, 'HAST'],
    ['Pacific/Honolulu', -600, 'HST', -600, 'HST'],
  ] as const)('%s: %d %s in July, %d %s in December', (zone, jo, ja, dO, da) => {
    expect(offsetAt(JULY, zone)).toBe(jo);
    expect(abbreviationAt(JULY, zone)).toBe(ja);
    expect(offsetAt(DECEMBER, zone)).toBe(dO);
    expect(abbreviationAt(DECEMBER, zone)).toBe(da);
  });

  it('takes an ISO string as well as a Date', () => {
    expect(offsetAt('2026-07-01T12:00:00Z', 'America/New_York')).toBe(-240);
  });
});

describe('toOffsetDateTime', () => {
  it("states an instant in the venue's offset", () => {
    expect(toOffsetDateTime(new Date('2026-10-01T23:00:00Z'), 'America/New_York')).toBe(
      '2026-10-01T19:00:00-04:00',
    );
    expect(toOffsetDateTime('2026-12-05T01:00:00Z', 'America/New_York')).toBe(
      '2026-12-04T20:00:00-05:00',
    );
  });

  it('tells the two 1:30 AM moments of 2027-11-07 apart', () => {
    expect(toOffsetDateTime(new Date('2027-11-07T05:30:00Z'), 'America/New_York')).toBe(
      '2027-11-07T01:30:00-04:00',
    );
    expect(toOffsetDateTime(new Date('2027-11-07T06:30:00Z'), 'America/New_York')).toBe(
      '2027-11-07T01:30:00-05:00',
    );
  });

  it('round-trips through parseOffsetDateTime and resolveLocal', () => {
    const sent = toOffsetDateTime(new Date('2027-11-07T06:30:00Z'), 'America/New_York');
    const parsed = parseOffsetDateTime(sent);
    expect(parsed).toEqual({ local: '2027-11-07T01:30:00', offsetMinutes: -300 });
  });
});

describe('parseOffsetDateTime', () => {
  it.each([
    ['2026-10-01T19:00:00-04:00', '2026-10-01T19:00:00', -240],
    ['2026-10-01T19:00-04:00', '2026-10-01T19:00:00', -240],
    ['2026-10-01T19:00:00.123-04:00', '2026-10-01T19:00:00.123', -240],
    ['2026-10-01T19:00:00Z', '2026-10-01T19:00:00', 0],
    ['2026-10-01T19:00:00+05:30', '2026-10-01T19:00:00', 330],
  ])('reads %s', (s, local, offsetMinutes) => {
    expect(parseOffsetDateTime(s)).toEqual({ local, offsetMinutes });
  });

  it.each([
    '2026-10-01T19:00:00',
    '2026-10-01',
    '2026-10-01 19:00:00-04:00',
    '2026-10-01T24:00:00-04:00',
    '2026-10-01T19:60:00-04:00',
    '2026-02-30T19:00:00-04:00',
    '2026-10-01T19:00:00-24:00',
    'garbage',
    '',
  ])('refuses %s', (s) => {
    expect(parseOffsetDateTime(s)).toBeNull();
  });
});

describe('toLocalDateTime and localDate', () => {
  it('shows local midnight as T00:00, never T24:00 (hourCycle h23)', () => {
    expect(toLocalDateTime(new Date('2026-10-02T04:00:00Z'), 'America/New_York')).toBe(
      '2026-10-02T00:00',
    );
    expect(toLocalDateTime(new Date('2026-10-02T00:00:00Z'), 'America/New_York')).toBe(
      '2026-10-01T20:00',
    );
  });

  it("gives the venue's local date", () => {
    // 9:00 PM PDT on Oct 1 is already Oct 2 in UTC and in Eastern time (US1 scenario 6).
    expect(localDate(new Date('2026-10-02T04:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-01');
    expect(localDate(new Date('2026-10-02T04:00:00Z'), 'America/New_York')).toBe('2026-10-02');
  });
});

describe('formatters (R11, R12)', () => {
  it('formats an event time with its abbreviation', () => {
    const at = new Date('2026-10-01T23:00:00Z');
    expect(formatEventTime(at, 'America/New_York')).toBe('Oct 1, 2026, 7:00 PM EDT');
    expect(formatTimeOfDay(at, 'America/New_York')).toBe('7:00 PM EDT');
    expect(formatEventDate(at, 'America/New_York')).toBe('Oct 1, 2026');
  });

  it('uses EST in winter and MST all year in Phoenix', () => {
    expect(formatEventTime('2026-12-06T01:00:00Z', 'America/New_York')).toBe(
      'Dec 5, 2026, 8:00 PM EST',
    );
    expect(formatEventTime('2026-07-02T02:00:00Z', 'America/Phoenix')).toBe(
      'Jul 1, 2026, 7:00 PM MST',
    );
  });

  it('gives an event across midnight two dates', () => {
    const start = new Date('2026-10-02T02:00:00Z'); // 10:00 PM EDT on Oct 1
    const end = new Date('2026-10-02T05:00:00Z'); // 1:00 AM EDT on Oct 2
    expect(formatEventDate(start, 'America/New_York')).toBe('Oct 1, 2026');
    expect(formatEventDate(end, 'America/New_York')).toBe('Oct 2, 2026');
    expect(formatEventTime(end, 'America/New_York')).toBe('Oct 2, 2026, 1:00 AM EDT');
  });

  it('formats 12:05 AM and 12:30 PM', () => {
    expect(formatTimeOfDay('2026-10-01T04:05:00Z', 'America/New_York')).toBe('12:05 AM EDT');
    expect(formatTimeOfDay('2026-10-01T16:30:00Z', 'America/New_York')).toBe('12:30 PM EDT');
  });

  it("formats a viewer's time in the process's own zone, with its abbreviation", () => {
    const at = new Date('2026-10-01T23:42:00Z');
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const abbr = new Intl.DateTimeFormat('en-US', { timeZone: own, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    const text = formatViewerTime(at);
    expect(text.endsWith(` ${abbr}`)).toBe(true);
    expect(text).toMatch(/^\d{1,2}:42 (AM|PM) \S+$/);
  });
});

describe('R9 message helpers', () => {
  it("states a skipped time as the Backend's LOCAL_TIME_SKIPPED and the form say it", () => {
    expect(skippedTimeMessage('2027-03-14T02:30', 'America/New_York', '02:00', '03:00')).toBe(
      "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 " +
        'AM. Choose another time.',
    );
  });

  it('formats a local wall time and date without any zone', () => {
    expect(formatLocalTime('2027-11-07T01:30')).toBe('1:30 AM');
    expect(formatLocalTime('2026-10-01T19:00:59')).toBe('7:00 PM');
    expect(formatLocalTime('2026-10-01T00:05')).toBe('12:05 AM');
    expect(formatLocalTime('2026-10-01T12:00')).toBe('12:00 PM');
    expect(formatLocalDateTime('2027-03-14T02:30')).toBe('Mar 14, 2027, 2:30 AM');
  });

  it('formats an end with its date only when its local date differs from the start', () => {
    const start = '2026-10-01T23:00:00Z'; // 7:00 PM EDT
    expect(formatEventEnd(start, '2026-10-02T02:00:00Z', 'America/New_York')).toBe('10:00 PM EDT');
    expect(formatEventEnd('2026-10-02T02:00:00Z', '2026-10-02T05:00:00Z', 'America/New_York')).toBe(
      'Oct 2, 2026, 1:00 AM EDT',
    );
  });
});

/**
 * Review round 2, m4: before standard time (1883) ICU gives local mean time, such as
 * `GMT-04:56:02`; an offset the module cannot read is unknown, never 0 (+00:00).
 */
describe('an offset ICU gives in seconds', () => {
  it('is refused as unknown, not read as UTC', () => {
    expect(() => offsetAt('1850-06-01T12:00:00Z', 'America/New_York')).toThrow(RangeError);
    expect(() => toOffsetDateTime('1850-06-01T12:00:00Z', 'America/New_York')).toThrow(RangeError);
    expect(() => resolveLocal('1850-06-01T08:00', 'America/New_York')).toThrow(RangeError);
  });

  it('still reads UTC itself as 0', () => {
    expect(offsetAt('2026-10-01T12:00:00Z', 'UTC')).toBe(0);
  });
});
