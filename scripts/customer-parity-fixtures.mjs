// Spec 040 research R9, R10 (T054–T056): the Rust Customer app's parity fixtures. Imports the
// React Customer app's TypeScript unchanged (customer-app/src/calendar.ts and
// packages/shared/src/live-code.ts) and `qrcode-generator` 2.0.4 as customer-app/src/components/
// TicketQr.tsx calls it (type 0, level M, one alphanumeric segment), runs them on fixed inputs,
// and writes what they give to customer-rust-app/core/tests/fixtures/customer/, where
// core/tests/{calendar,live_code,qr}.rs check that the Rust ports give the same: the ICS text, the
// file name, the Google link, the live codes, and the QR module grids, byte for byte. Usage, from
// the repository root:
//
//   npx tsx scripts/customer-parity-fixtures.mjs           # writes the expected files
//   npx tsx scripts/customer-parity-fixtures.mjs --check   # exits 1 when a committed file differs
//
// Every input is fixed and nothing reads the clock (DTSTAMP's `now` is an input), so each run
// writes the same bytes. `filters.ts` needs no fixture here: its rules are plain string work,
// ported case by case in core/tests/filters.rs.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calendarEligible,
  calendarEntry,
  googleCalendarUrl,
  icsFile,
  icsFileName,
} from '../customer-app/src/calendar.ts';
import { keyToBase64url, liveCode } from '../packages/shared/src/live-code.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = join(ROOT, 'customer-rust-app', 'core', 'tests', 'fixtures', 'customer');
const check = process.argv.includes('--check');
// `qrcode-generator` from the workspace's node_modules (or NODE_PATH), as the Customer app has it.
const qrcode = createRequire(import.meta.url)('qrcode-generator');

// ------------------------------------------------------------------------------ calendar

const EVENT_ID = '6f1c2a4e-3b7d-4e2f-9a10-5c8d7e6f4a21';
const orderEvent = (over = {}) => ({
  id: EVENT_ID,
  name: 'Season Opener',
  startsAt: '2026-10-31T23:30:00.000Z',
  doorsOpenAt: '2026-10-31T22:30:00.000Z',
  endsAt: '2026-11-01T02:45:00.000Z',
  status: 'SCHEDULED',
  location: { id: 'v1', name: 'KFC Yum! Center', address: '1 ARENA PLAZA, LOUISVILLE, KY 40202' },
  ...over,
});
const venueAt = (name, address) => ({ id: 'v1', name, address });
const LONG_VENUE = 'Hall, of; Fame '.repeat(13) + 'Arena';
const MAX_ADDRESS = ('12 Main St, Suite 4; Floor 2, '.repeat(16) + 'LOUISVILLE, KY 40202 ').slice(
  0,
  500,
);

const CALENDAR_EVENTS = [
  ['the R3 example', orderEvent()],
  [
    'crossing midnight',
    orderEvent({ startsAt: '2026-11-07T03:00:00.000Z', endsAt: '2026-11-07T07:00:00.000Z' }),
  ],
  [
    'crossing the new year',
    orderEvent({ startsAt: '2026-12-31T23:00:00Z', endsAt: '2027-01-01T02:00:00Z' }),
  ],
  [
    'milliseconds dropped',
    orderEvent({ startsAt: '2026-10-31T23:30:00.999Z', endsAt: '2026-11-01T02:45:59.999Z' }),
  ],
  [
    'every escape at once',
    orderEvent({
      name: 'Rock, Paper; Scissors \\ Live\r\nTour',
      location: venueAt('Hall "A": North', 'Back\\door; 2, LOUISVILLE'),
    }),
  ],
  [
    'control characters',
    orderEvent({ name: 'A\u0000B\u0007C\tD\u007F\u001F', location: venueAt('V\u001F', 'X\r') }),
  ],
  ['200 ASCII', orderEvent({ name: 'x'.repeat(200) })],
  ['67 and 68 octets', orderEvent({ name: 'y'.repeat(68) })],
  ['é × 100', orderEvent({ name: 'é'.repeat(100) })],
  ['漢 × 70', orderEvent({ name: '漢'.repeat(70) })],
  ['🎉 × 50', orderEvent({ name: '🎉'.repeat(50) })],
  ['mixed', orderEvent({ name: 'aé漢🎉'.repeat(30) })],
  ['a \\, on a fold', orderEvent({ location: venueAt('a'.repeat(65), 'LOUISVILLE') })],
  [
    'the maximum LOCATION',
    orderEvent({
      name: 'Café Noël 🎉 ' + 'n'.repeat(187),
      location: venueAt(LONG_VENUE, MAX_ADDRESS),
    }),
  ],
  ['a name to slug', orderEvent({ name: 'Show #2: Encore! Ünïcödé & Co' })],
  ['an end equal to the start', orderEvent({ endsAt: '2026-10-31T23:30:00.000Z' })],
  ['an end before the start', orderEvent({ endsAt: '2026-10-31T23:29:59.000Z' })],
];
const NOW = new Date('2026-10-24T15:30:07.999Z');

const calendar = CALENDAR_EVENTS.map(([label, event]) => {
  let ics = null;
  let google = null;
  try {
    ics = icsFile(calendarEntry(event), NOW);
    google = googleCalendarUrl(calendarEntry(event));
  } catch {
    // An end not after the start: the TypeScript throws (research R14).
  }
  return {
    label,
    event,
    now: NOW.toISOString(),
    ics,
    google,
    fileName: icsFileName(event.name),
  };
});

const FILE_NAMES = [
  'Season Opener',
  'Rock, Paper; Scissors \\ Live',
  'Café Noël',
  '  --A--  ',
  '🎉🎉',
  '漢字',
  '',
  'Show #2: Encore!',
  'X'.repeat(200),
  'a'.repeat(59) + ' ' + 'b'.repeat(140),
  'ﬁnal ½ Ⅻ ①',
  'Ǆemal Ǳ',
].map((name) => ({ name, fileName: icsFileName(name) }));

const eligibleOrder = (over = {}, event = {}) => ({
  id: 'o1',
  tickets: [{ status: 'VALID' }],
  ...over,
  event: orderEvent(event),
});
const END = Date.parse('2026-11-01T02:45:00.000Z');
const ELIGIBLE = [
  ['scheduled, future, valid', eligibleOrder(), NOW.getTime()],
  ['cancelled', eligibleOrder({}, { status: 'CANCELLED' }), NOW.getTime()],
  ['1 ms before the end', eligibleOrder(), END - 1],
  ['at the end', eligibleOrder(), END],
  ['only void tickets', eligibleOrder({ tickets: [{ status: 'VOID' }] }), NOW.getTime()],
  ['no tickets', eligibleOrder({ tickets: [] }), NOW.getTime()],
  ['an end before the start', eligibleOrder({}, { endsAt: '2026-10-31T23:00:00.000Z' }), 0],
  ['an unreadable start', eligibleOrder({}, { startsAt: 'garbage' }), 0],
].map(([label, order, nowMs]) => ({
  label,
  order,
  nowMs,
  eligible: calendarEligible(order, nowMs),
}));

// ------------------------------------------------------------------------------ live codes

const SECRETS = [
  new Uint8Array(32).fill(0x00),
  new Uint8Array(32).fill(0xff),
  Uint8Array.from({ length: 32 }, (_, i) => i),
  Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff),
];
const TICKETS = [
  '3b8e5f0a-6c1d-4b7e-9a2f-1d0c3e4b5a69',
  '00000000-0000-4000-8000-000000000000',
  'ffffffff-ffff-4fff-bfff-ffffffffffff',
];
const WINDOWS = [0, 1, 58773103, 59000000, 999999999];
const liveCodes = [];
for (const secret of SECRETS)
  for (const ticketId of TICKETS)
    for (const window of WINDOWS)
      liveCodes.push({
        key: keyToBase64url(secret),
        ticketId,
        window,
        code: await liveCode(secret, ticketId, window),
      });

// ------------------------------------------------------------------------------ QR grids

/** `qrMatrix` of TicketQr.tsx, each row as a string of 0 and 1. */
function grid(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Alphanumeric');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (qr.isDark(r, c) ? '1' : '0')).join(''),
  );
}
const QR_TEXTS = [
  'AAAA2222BBBB',
  '7KQ2M9XWAB4C',
  liveCodes[0].code,
  liveCodes[17].code,
  liveCodes[33].code,
  liveCodes[59].code,
  'QP1:ABC',
  'HELLO WORLD $%*+-./:',
  'A'.repeat(100),
];
const qr = QR_TEXTS.map((text) => ({ text, grid: grid(text) }));

// ------------------------------------------------------------------------------ write

const files = {
  'calendar.json': { files: calendar, fileNames: FILE_NAMES, eligible: ELIGIBLE },
  'live-codes.json': liveCodes,
  'qr.json': qr,
};
mkdirSync(OUT_DIR, { recursive: true });
// Written as the repository's Prettier settings format JSON, so `format:check` passes.
const PRETTIER = await prettier.resolveConfig(join(OUT_DIR, 'any.json'));
let differs = false;
for (const [name, value] of Object.entries(files)) {
  const path = join(OUT_DIR, name);
  const text = await prettier.format(JSON.stringify(value), { ...PRETTIER, parser: 'json' });
  if (check) {
    let committed = '';
    try {
      committed = readFileSync(path, 'utf8');
    } catch {
      // missing
    }
    if (committed !== text) {
      console.error(`differs: ${path}`);
      differs = true;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}
if (differs) process.exit(1);
