// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MyOrder, OrderEvent, Ticket } from '@queuepass/shared';
import {
  calendarEligible,
  calendarEntry,
  googleCalendarUrl,
  icsFile,
  icsFileName,
} from '../src/calendar';

// Spec 020's ground rule: an unset TZ is restored by deleting it, never by assigning undefined
// (Node would read the string "undefined" as an unknown zone).
function restoreTz(before: string | undefined): void {
  if (before === undefined) delete process.env.TZ;
  else process.env.TZ = before;
}

/**
 * Spec 019 FR-004 to FR-009, SC-002, SC-003 (research R3 to R7, R10, R12, R14, R15): the calendar
 * file generator. Every expected file below is written out by hand from the research, never
 * produced by the code under test.
 */

const CRLF = '\r\n';
const NOW = new Date('2026-10-24T15:30:00.000Z');
const EVENT_ID = '6f1c2a4e-3b7d-4e2f-9a10-5c8d7e6f4a21';

// --- Shell zone (research R5, tasks ground rule 3) --------------------------------------------

/** The only zones the shell runs may use, with their offsets on 2026-10-24. */
const SHELL_OFFSETS: Record<string, number> = {
  UTC: 0,
  'America/New_York': 240,
  'America/Los_Angeles': 420,
};
const shellZone = process.env.CALENDAR_TEST_TZ;

beforeAll(() => {
  if (!shellZone) return;
  process.env.TZ = shellZone;
  expect(Object.keys(SHELL_OFFSETS), `CALENDAR_TEST_TZ=${shellZone} is not allowed`).toContain(
    shellZone,
  );
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(shellZone);
  const offset = new Date('2026-10-24T12:00:00Z').getTimezoneOffset();
  expect(offset).toBe(SHELL_OFFSETS[shellZone]);
  console.log(`[calendar-tz] ${shellZone} offset ${offset}`);
});

// --- Fixtures ---------------------------------------------------------------------------------

const orderEvent = (over: Partial<OrderEvent> = {}): OrderEvent => ({
  id: EVENT_ID,
  name: 'Season Opener',
  startsAt: '2026-10-31T23:30:00.000Z',
  endsAt: '2026-11-01T02:45:00.000Z',
  status: 'SCHEDULED',
  location: { id: 'v1', name: 'KFC Yum! Center', address: '1 ARENA PLAZA, LOUISVILLE, KY 40202' },
  ...over,
});

const venueAt = (name: string, address: string): OrderEvent['location'] => ({
  id: 'v1',
  name,
  address,
});

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 'k1',
  code: 'AAAA2222BBBB',
  status: 'VALID',
  checkedInAt: null,
  seat: null,
  ...over,
});

const myOrder = (over: Partial<MyOrder> = {}): MyOrder => ({
  id: 'o1',
  eventId: EVENT_ID,
  tierId: null,
  tierName: null,
  customerUsername: 'customer1',
  holderName: 'Jordan Lee',
  quantity: 2,
  unitPrice: '45.50',
  totalPrice: '91.00',
  status: 'CONFIRMED',
  createdAt: '2026-10-03T15:00:00.000Z',
  refundedAt: null,
  tickets: [ticket(), ticket({ id: 'k2', code: 'CCCC3333DDDD' })],
  event: orderEvent(),
  ...over,
});

const fileOf = (e: OrderEvent, now = NOW): string => icsFile(calendarEntry(e), now);

/** An expected file, from its hand-written content lines (already escaped and folded). */
const expectedFile = (o: {
  uid?: string;
  stamp?: string;
  start: string;
  end: string;
  summary: string[];
  location: string[];
}): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QueuePass//Customer app//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:queuepass-event-${o.uid ?? EVENT_ID}`,
    `DTSTAMP:${o.stamp ?? '20261024T153000Z'}`,
    `DTSTART:${o.start}`,
    `DTEND:${o.end}`,
    ...o.summary,
    ...o.location,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map((line) => line + CRLF)
    .join('');

const ARENA = ['LOCATION:KFC Yum! Center\\, 1 ARENA PLAZA\\, LOUISVILLE\\, KY 40202'];
const START = '20261031T233000Z';
const END = '20261101T024500Z';

/** Research R3's example, character for character. */
const R3_EXAMPLE =
  'BEGIN:VCALENDAR\r\n' +
  'VERSION:2.0\r\n' +
  'PRODID:-//QueuePass//Customer app//EN\r\n' +
  'CALSCALE:GREGORIAN\r\n' +
  'METHOD:PUBLISH\r\n' +
  'BEGIN:VEVENT\r\n' +
  'UID:queuepass-event-6f1c2a4e-3b7d-4e2f-9a10-5c8d7e6f4a21\r\n' +
  'DTSTAMP:20261024T153000Z\r\n' +
  'DTSTART:20261031T233000Z\r\n' +
  'DTEND:20261101T024500Z\r\n' +
  'SUMMARY:Season Opener\r\n' +
  'LOCATION:KFC Yum! Center\\, 1 ARENA PLAZA\\, LOUISVILLE\\, KY 40202\r\n' +
  'END:VEVENT\r\n' +
  'END:VCALENDAR\r\n';

const LONG_VENUE = 'Hall, of; Fame '.repeat(13) + 'Arena'; // 200 characters
const LONG_ADDRESS = '12 Main St, Suite 4; Floor 2, '.repeat(16) + 'LOUISVILLE, KY 40202 '; // 501
const MAX_ADDRESS = LONG_ADDRESS.slice(0, 500);

/**
 * Every fixture with its committed expected file. Used by the round-trip reader and by the time
 * zone loop, and in a shell run under `CALENDAR_TEST_TZ` (R5).
 */
const FIXTURES: { label: string; event: OrderEvent; expected: string; name: string }[] = [
  { label: 'the R3 example', event: orderEvent(), expected: R3_EXAMPLE, name: 'Season Opener' },
  {
    label: 'an event crossing midnight UTC and local',
    event: orderEvent({ startsAt: '2026-11-07T03:00:00.000Z', endsAt: '2026-11-07T07:00:00.000Z' }),
    expected: expectedFile({
      start: '20261107T030000Z',
      end: '20261107T070000Z',
      summary: ['SUMMARY:Season Opener'],
      location: ARENA,
    }),
    name: 'Season Opener',
  },
  {
    label: 'an event crossing the new year',
    event: orderEvent({ startsAt: '2026-12-31T23:00:00Z', endsAt: '2027-01-01T02:00:00Z' }),
    expected: expectedFile({
      start: '20261231T230000Z',
      end: '20270101T020000Z',
      summary: ['SUMMARY:Season Opener'],
      location: ARENA,
    }),
    name: 'Season Opener',
  },
  {
    label: 'every escape at once',
    event: orderEvent({
      name: 'Rock, Paper; Scissors \\ Live\r\nTour',
      location: venueAt('Hall "A": North', 'Back\\door; 2, LOUISVILLE'),
    }),
    expected: expectedFile({
      start: START,
      end: END,
      summary: ['SUMMARY:Rock\\, Paper\\; Scissors \\\\ Live\\nTour'],
      location: ['LOCATION:Hall "A": North\\, Back\\\\door\\; 2\\, LOUISVILLE'],
    }),
    name: 'Rock, Paper; Scissors \\ Live\nTour',
  },
  {
    label: 'a 200-character ASCII name',
    event: orderEvent({ name: 'x'.repeat(200) }),
    expected: expectedFile({
      start: START,
      end: END,
      summary: ['SUMMARY:' + 'x'.repeat(67), ' ' + 'x'.repeat(74), ' ' + 'x'.repeat(59)],
      location: ARENA,
    }),
    name: 'x'.repeat(200),
  },
  {
    label: 'é × 100 (2 octets each)',
    event: orderEvent({ name: 'é'.repeat(100) }),
    expected: expectedFile({
      start: START,
      end: END,
      summary: ['SUMMARY:' + 'é'.repeat(33), ' ' + 'é'.repeat(37), ' ' + 'é'.repeat(30)],
      location: ARENA,
    }),
    name: 'é'.repeat(100),
  },
  {
    label: '漢 × 70 (3 octets each)',
    event: orderEvent({ name: '漢'.repeat(70) }),
    expected: expectedFile({
      start: START,
      end: END,
      summary: ['SUMMARY:' + '漢'.repeat(22), ' ' + '漢'.repeat(24), ' ' + '漢'.repeat(24)],
      location: ARENA,
    }),
    name: '漢'.repeat(70),
  },
  {
    label: '🎉 × 50 (4 octets each)',
    event: orderEvent({ name: '🎉'.repeat(50) }),
    expected: expectedFile({
      start: START,
      end: END,
      summary: ['SUMMARY:' + '🎉'.repeat(16), ' ' + '🎉'.repeat(18), ' ' + '🎉'.repeat(16)],
      location: ARENA,
    }),
    name: '🎉'.repeat(50),
  },
  {
    label: 'a \\, on a fold',
    event: orderEvent({ location: venueAt('a'.repeat(65), 'LOUISVILLE') }),
    expected: expectedFile({
      start: START,
      end: END,
      summary: ['SUMMARY:Season Opener'],
      // "LOCATION:" (9) + 65 + "\" = 75; the "," that the backslash escapes starts line 2.
      location: ['LOCATION:' + 'a'.repeat(65) + '\\', ' , LOUISVILLE'],
    }),
    name: 'Season Opener',
  },
];

/** The maximum-length LOCATION (SC-003), checked by properties and by the reader. */
const MAX_LOCATION = orderEvent({
  name: 'Café Noël 🎉 ' + 'n'.repeat(187),
  location: venueAt(LONG_VENUE, MAX_ADDRESS),
});

// --- A small reader (research R13, R15) --------------------------------------------------------

/** Unfolds, splits into lines, splits each at the first ":", and unescapes TEXT values. */
function read(file: string): Record<string, string> {
  const unfolded = file.replace(/\r\n[ \t]/g, '');
  const props: Record<string, string> = {};
  for (const line of unfolded.split('\r\n').filter((l) => l !== '')) {
    const at = line.indexOf(':');
    props[line.slice(0, at)] = line
      .slice(at + 1)
      .replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
  }
  return props;
}

/** The raw, unfolded value of one property (still escaped). */
const raw = (file: string, prop: string): string =>
  file
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .find((l) => l.startsWith(`${prop}:`))!
    .slice(prop.length + 1);

const octets = (s: string): number => new TextEncoder().encode(s).length;

/** RFC 5545 §3.1 and research R7: what every file in this test must satisfy. */
function expectWellFormed(file: string): void {
  expect(file.endsWith(CRLF)).toBe(true);
  expect(/\n/.test(file.replace(/\r\n/g, ''))).toBe(false); // no LF without CR
  expect(/\r/.test(file.replace(/\r\n/g, ''))).toBe(false); // no CR without LF
  const lines = file.slice(0, -2).split(CRLF);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const line of lines) {
    expect(octets(line)).toBeLessThanOrEqual(75);
    // Each line decodes on its own: no character is split across a fold.
    expect(() => decoder.decode(new TextEncoder().encode(line))).not.toThrow();
    expect(line.includes('\uFFFD')).toBe(false);
    if (line.startsWith(' ')) expect(line.startsWith('  ')).toBe(false);
  }
}

// --- Tests -------------------------------------------------------------------------------------

describe('icsFile: the exact file (R3)', () => {
  it("is research R3's example, character for character, CRLF after every line", () => {
    expect(fileOf(orderEvent())).toBe(R3_EXAMPLE);
  });

  it.each(FIXTURES)('$label equals its committed expected file', ({ event, expected }) => {
    const file = fileOf(event);
    expect(file).toBe(expected);
    expectWellFormed(file);
  });

  it('starts with no byte order mark', () => {
    expect(fileOf(orderEvent()).startsWith('BEGIN:VCALENDAR')).toBe(true);
  });
});

describe('icsFile: times (R5, R14)', () => {
  it('drops milliseconds', () => {
    const file = fileOf(
      orderEvent({ startsAt: '2026-10-31T23:30:00.999Z', endsAt: '2026-11-01T02:45:59.999Z' }),
      new Date('2026-10-24T15:30:07.999Z'),
    );
    expect(raw(file, 'DTSTART')).toBe('20261031T233000Z');
    expect(raw(file, 'DTEND')).toBe('20261101T024559Z');
    expect(raw(file, 'DTSTAMP')).toBe('20261024T153007Z');
  });

  it('pads every part of an early-in-the-year time', () => {
    const file = fileOf(
      orderEvent({ startsAt: '2027-01-02T03:04:05Z', endsAt: '2027-01-02T04:04:05Z' }),
      new Date('2027-01-01T00:00:09Z'),
    );
    expect(raw(file, 'DTSTART')).toBe('20270102T030405Z');
    expect(raw(file, 'DTSTAMP')).toBe('20270101T000009Z');
  });

  it.each([
    ['equal to', '2026-10-31T23:30:00.000Z'],
    ['before', '2026-10-31T23:29:59.000Z'],
  ])('refuses an end %s the start', (_label, endsAt) => {
    expect(() => fileOf(orderEvent({ endsAt }))).toThrow();
  });
});

describe('UID and DTSTAMP (R4, FR-007)', () => {
  it('gives two orders of one event, made at two moments, the same UID and nothing else different but DTSTAMP', () => {
    const a = myOrder({ id: 'o1' });
    const b = myOrder({ id: 'o2', holderName: 'Sam Rivera', quantity: 1 });
    const fileA = icsFile(calendarEntry(a.event), NOW);
    const fileB = icsFile(calendarEntry(b.event), new Date('2026-10-25T09:00:00.000Z'));

    expect(raw(fileA, 'UID')).toBe(`queuepass-event-${EVENT_ID}`);
    expect(raw(fileB, 'UID')).toBe(raw(fileA, 'UID'));
    expect(raw(fileA, 'DTSTAMP')).toBe('20261024T153000Z');
    expect(raw(fileB, 'DTSTAMP')).toBe('20261025T090000Z');
    const withoutStamp = (f: string) => f.replace(/^DTSTAMP:.*$/m, '');
    expect(withoutStamp(fileB)).toBe(withoutStamp(fileA));
  });
});

describe('escaping (R6)', () => {
  const summary = (name: string) => raw(fileOf(orderEvent({ name })), 'SUMMARY');

  it.each([
    ['a backslash', 'a\\b', 'a\\\\b'],
    ['a semicolon', 'a;b', 'a\\;b'],
    ['a comma', 'a,b', 'a\\,b'],
    ['CRLF', 'a\r\nb', 'a\\nb'],
    ['LF', 'a\nb', 'a\\nb'],
    ['CR', 'a\rb', 'a\\nb'],
    ['U+0000', 'a\u0000b', 'ab'],
    ['U+0007', 'a\u0007b', 'ab'],
    ['U+001F', 'a\u001Fb', 'ab'],
    ['U+007F', 'a\u007Fb', 'ab'],
    ['a tab (kept)', 'a\tb', 'a\tb'],
    ['a colon (unchanged)', 'a:b', 'a:b'],
    ['a double quote (unchanged)', 'a"b', 'a"b'],
    ['non-ASCII (unchanged)', 'Café 漢 🎉', 'Café 漢 🎉'],
  ])('%s', (_label, name, expected) => {
    expect(summary(name)).toBe(expected);
  });

  it('all at once, the backslash first so added backslashes are not doubled', () => {
    expect(summary('\\;,\r\n\n\r\u0000\t:"')).toBe('\\\\\\;\\,\\n\\n\\n\t:"');
  });

  it('builds LOCATION as escape(name) + "\\, " + escape(address)', () => {
    const file = fileOf(orderEvent({ location: venueAt('A, B; C\\', 'D, E') }));
    expect(raw(file, 'LOCATION')).toBe('A\\, B\\; C\\\\\\, D\\, E');
  });
});

describe('folding (R7)', () => {
  const lines = (file: string) => file.slice(0, -2).split(CRLF);
  const summaryLines = (file: string) => {
    const all = lines(file);
    const i = all.findIndex((l) => l.startsWith('SUMMARY:'));
    const out = [all[i]];
    for (let j = i + 1; all[j].startsWith(' '); j++) out.push(all[j]);
    return out;
  };

  it('does not fold a SUMMARY line of exactly 75 octets', () => {
    const file = fileOf(orderEvent({ name: 'y'.repeat(67) }));
    expect(summaryLines(file)).toEqual(['SUMMARY:' + 'y'.repeat(67)]);
    expect(octets(summaryLines(file)[0])).toBe(75);
  });

  it('folds a line of 76 octets into 75 and a space plus 1', () => {
    const file = fileOf(orderEvent({ name: 'y'.repeat(68) }));
    expect(summaryLines(file)).toEqual(['SUMMARY:' + 'y'.repeat(67), ' y']);
  });

  it('folds the 200-character ASCII name into 75, 75, and 60 octets', () => {
    const file = fileOf(orderEvent({ name: 'x'.repeat(200) }));
    expect(summaryLines(file).map(octets)).toEqual([75, 75, 60]);
  });

  it.each([
    ['é × 100', 'é'.repeat(100)],
    ['漢 × 70', '漢'.repeat(70)],
    ['🎉 × 50', '🎉'.repeat(50)],
    ['mixed', 'aé漢🎉'.repeat(30)],
  ])('never splits a character: %s', (_label, name) => {
    const file = fileOf(orderEvent({ name }));
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const line of summaryLines(file)) {
      expect(octets(line)).toBeLessThanOrEqual(75);
      expect(() => decoder.decode(new TextEncoder().encode(line))).not.toThrow();
    }
    expect(read(file).SUMMARY).toBe(name);
    expectWellFormed(file);
  });

  it('may fold between a backslash and the comma it escapes, and the reader still reads it', () => {
    const file = fileOf(orderEvent({ location: venueAt('a'.repeat(65), 'LOUISVILLE') }));
    const all = lines(file);
    const i = all.findIndex((l) => l.startsWith('LOCATION:'));
    expect(all[i].endsWith('\\')).toBe(true);
    expect(all[i + 1].startsWith(' ,')).toBe(true);
    expect(read(file).LOCATION).toBe('a'.repeat(65) + ', LOUISVILLE');
  });

  it('keeps every line of the maximum-length LOCATION within 75 octets', () => {
    expectWellFormed(fileOf(MAX_LOCATION));
  });
});

describe('round trip through a reader (SC-003)', () => {
  it.each(FIXTURES)('$label reads back exactly', ({ event, name }) => {
    const props = read(fileOf(event));
    expect(props.SUMMARY).toBe(name);
    expect(props.LOCATION).toBe(`${event.location.name}, ${event.location.address}`);
  });

  it('reads back the maximum-length LOCATION and a long accented name whole', () => {
    expect(LONG_VENUE).toHaveLength(200);
    expect(MAX_ADDRESS).toHaveLength(500);
    expect(MAX_LOCATION.name).toHaveLength(200);
    const props = read(fileOf(MAX_LOCATION));
    expect(props.SUMMARY).toBe(MAX_LOCATION.name);
    expect(props.LOCATION).toBe(`${LONG_VENUE}, ${MAX_ADDRESS}`);
  });

  it('reads back names with control characters, minus those characters', () => {
    const props = read(
      fileOf(orderEvent({ name: 'A\u0000B\u0007C\tD\u007F', location: venueAt('V\u001F', 'X') })),
    );
    expect(props.SUMMARY).toBe('ABC\tD');
    expect(props.LOCATION).toBe('V, X');
  });
});

describe('time zones (R5, SC-002)', () => {
  const ZONES: [string, number][] = [
    ['UTC', 0],
    ['America/New_York', 240],
    ['America/Los_Angeles', 420],
    ['Asia/Kolkata', -330],
  ];

  it.each(ZONES)('makes every fixture byte for byte the same under TZ=%s', (zone, offset) => {
    const before = process.env.TZ;
    try {
      process.env.TZ = zone;
      expect(new Date('2026-10-24T12:00:00Z').getTimezoneOffset()).toBe(offset);
      for (const f of FIXTURES) expect(fileOf(f.event)).toBe(f.expected);
    } finally {
      restoreTz(before);
    }
  });
});

describe('nothing extra (FR-004)', () => {
  it('has no ticket code, holder, price, order, or account, and no extra property', () => {
    const o = myOrder({
      id: 'order-9f8e',
      holderName: 'Jordan Lee',
      customerUsername: 'customer-account-1',
      totalPrice: '91.37',
      unitPrice: '45.68',
      tickets: [ticket({ code: 'ZZZZ9999YYYY' }), ticket({ id: 'k2', code: 'QQQQ7777WWWW' })],
    });
    const file = icsFile(calendarEntry(o.event), NOW);
    for (const secret of [
      'ZZZZ9999YYYY',
      'QQQQ7777WWWW',
      'Jordan Lee',
      'Jordan',
      '91.37',
      '45.68',
      'order-9f8e',
      'customer-account-1',
    ])
      expect(file).not.toContain(secret);
    for (const prop of [
      'DESCRIPTION',
      'URL',
      'ORGANIZER',
      'ATTENDEE',
      'VALARM',
      'TZID',
      'VTIMEZONE',
    ])
      expect(file).not.toContain(prop);
    expect(
      file
        .replace(/\r\n[ \t]/g, '')
        .split(CRLF)
        .filter(Boolean)
        .map((l) => l.split(':')[0]),
    ).toEqual([
      'BEGIN',
      'VERSION',
      'PRODID',
      'CALSCALE',
      'METHOD',
      'BEGIN',
      'UID',
      'DTSTAMP',
      'DTSTART',
      'DTEND',
      'SUMMARY',
      'LOCATION',
      'END',
      'END',
    ]);
  });
});

describe('icsFileName (R12, FR-009)', () => {
  it.each([
    ['Season Opener', 'season-opener.ics'],
    ['Rock, Paper; Scissors \\ Live', 'rock-paper-scissors-live.ics'],
    ['Café Noël', 'cafe-noel.ics'],
    ['  --A--  ', 'a.ics'],
    ['🎉🎉', 'event.ics'],
    ['漢字', 'event.ics'],
    ['', 'event.ics'],
    ['Show #2: Encore!', 'show-2-encore.ics'],
  ])('%j → %s', (name, expected) => {
    expect(icsFileName(name)).toBe(expected);
  });

  it('cuts a 200-character name to 60 characters before .ics', () => {
    expect(icsFileName('X'.repeat(200))).toBe('x'.repeat(60) + '.ics');
  });

  it('removes a dash the cut leaves at the end', () => {
    const name = 'a'.repeat(59) + ' ' + 'b'.repeat(140);
    const file = icsFileName(name);
    expect(file).toBe('a'.repeat(59) + '.ics');
    expect(file.slice(0, -4).length).toBeLessThanOrEqual(60);
    expect(file.slice(0, -4).endsWith('-')).toBe(false);
  });
});

describe('calendarEligible (R10, FR-002)', () => {
  const start = Date.parse('2026-10-31T23:30:00.000Z');
  const end = Date.parse('2026-11-01T02:45:00.000Z');
  const before = NOW.getTime();

  it('offers it for a scheduled, future event with valid tickets', () => {
    expect(calendarEligible(myOrder(), before)).toBe(true);
  });

  it('does not for a cancelled event', () => {
    const o = myOrder({ event: orderEvent({ status: 'CANCELLED' }) });
    expect(calendarEligible(o, before)).toBe(false);
  });

  it('offers it one millisecond before the end, not at the end (half-open window)', () => {
    expect(calendarEligible(myOrder(), end - 1)).toBe(true);
    expect(calendarEligible(myOrder(), end)).toBe(false);
    expect(calendarEligible(myOrder(), end + 1)).toBe(false);
  });

  it('offers it while the event is under way', () => {
    expect(calendarEligible(myOrder(), start + 60_000)).toBe(true);
  });

  it('does not when every ticket is void', () => {
    const o = myOrder({
      tickets: [ticket({ status: 'VOID' }), ticket({ id: 'k2', status: 'VOID' })],
    });
    expect(calendarEligible(o, before)).toBe(false);
  });

  it('does when one ticket is void and one valid', () => {
    const o = myOrder({ tickets: [ticket({ status: 'VOID' }), ticket({ id: 'k2' })] });
    expect(calendarEligible(o, before)).toBe(true);
  });

  it('does for a valid ticket already used at the gate', () => {
    const o = myOrder({ tickets: [ticket({ checkedInAt: '2026-10-31T23:40:00.000Z' })] });
    expect(calendarEligible(o, start + 600_000)).toBe(true);
  });
});

describe('googleCalendarUrl (R8, FR-011)', () => {
  const urlOf = (e: OrderEvent) => googleCalendarUrl(calendarEntry(e));

  it("is exactly the R3 example's link", () => {
    expect(urlOf(orderEvent())).toBe(
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Season+Opener&dates=20261031T233000Z%2F20261101T024500Z&location=KFC+Yum%21+Center%2C+1+ARENA+PLAZA%2C+LOUISVILLE%2C+KY+40202',
    );
  });

  it('gives back reserved characters, accents, and emoji exactly, with only four keys', () => {
    const name = 'Rock & Roll #1 / A+B 100% = ? Café 🎉';
    const venueName = 'Hall & Co. #2 / C+D 50% = ?';
    const address = '1 Main St, Fl. 2; Noël 🎉, LOUISVILLE, KY 40202';
    const url = new URL(urlOf(orderEvent({ name, location: venueAt(venueName, address) })));

    expect(`${url.origin}${url.pathname}`).toBe('https://calendar.google.com/calendar/render');
    expect([...url.searchParams.keys()]).toEqual(['action', 'text', 'dates', 'location']);
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(name);
    expect(url.searchParams.get('dates')).toBe('20261031T233000Z/20261101T024500Z');
    expect(url.searchParams.get('location')).toBe(`${venueName}, ${address}`);
    expect(url.searchParams.has('ctz')).toBe(false);
    expect(url.searchParams.has('details')).toBe(false);
  });

  it('is the same link under every TZ', () => {
    const before = process.env.TZ;
    const expected = urlOf(orderEvent());
    try {
      for (const [zone, offset] of [
        ['UTC', 0],
        ['America/New_York', 240],
        ['America/Los_Angeles', 420],
        ['Asia/Kolkata', -330],
      ] as const) {
        process.env.TZ = zone;
        expect(new Date('2026-10-24T12:00:00Z').getTimezoneOffset()).toBe(offset);
        expect(urlOf(orderEvent())).toBe(expected);
        expect(urlOf(FIXTURES[1].event)).toContain('dates=20261107T030000Z%2F20261107T070000Z');
      }
    } finally {
      restoreTz(before);
    }
  });

  it('keeps a 200-character name, venue name, and 500-character address whole', () => {
    const name = 'n'.repeat(199) + 'Z';
    const url = new URL(urlOf(orderEvent({ name, location: venueAt(LONG_VENUE, MAX_ADDRESS) })));
    expect(url.searchParams.get('text')).toBe(name);
    expect(url.searchParams.get('location')).toBe(`${LONG_VENUE}, ${MAX_ADDRESS}`);
  });

  it('refuses an end not after the start (R14)', () => {
    expect(() => urlOf(orderEvent({ endsAt: '2026-10-31T23:30:00.000Z' }))).toThrow();
  });
});

afterAll(() => {
  // A shell run must leave the zone it was given (research R5): no loop test changed it.
  if (shellZone) expect(process.env.TZ).toBe(shellZone);
});
