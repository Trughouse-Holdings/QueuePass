/**
 * Spec 037 T027 (research R6): writes the expected outputs of the TypeScript time module,
 * unchanged, for `core/tests/time.rs` to compare byte for byte. Run from the repo root:
 *
 *   npx tsx admin-rust-app/core/tests/fixtures/time/generate.mts
 *
 * It needs Node 22's full ICU (the same `Intl` the Admin app formats with).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  abbreviationAt,
  formatEventTime,
  formatViewerTime,
  offsetAt,
  toLocalDateTime,
  toOffsetDateTime,
  US_TIME_ZONES,
} from '../../../../../packages/shared/src/time-zone.ts';

const here = dirname(fileURLToPath(import.meta.url));
const tryOr = (f: () => string | number): string => {
  try {
    return String(f());
  } catch (e) {
    return `ERR ${(e as Error).message}`;
  }
};

// 1. Every zone `Intl` lists, some backward links, and UTC: the abbreviation and offset in
//    January and July 2026 (a device zone can be any of them, research R6).
const LINKS = [
  'UTC',
  'Etc/UTC',
  'GMT',
  'Etc/GMT',
  'Etc/UCT',
  'Universal',
  'Zulu',
  'Etc/GMT+5',
  'Etc/GMT-14',
  'US/Eastern',
  'US/Central',
  'US/Mountain',
  'US/Pacific',
  'US/Alaska',
  'US/Hawaii',
  'US/Aleutian',
  'US/Arizona',
  'US/Michigan',
  'US/East-Indiana',
  'US/Indiana-Starke',
  'America/Indiana/Indianapolis',
  'America/Kentucky/Louisville',
  'America/Fort_Wayne',
  'America/Knox_IN',
  'America/Atka',
  'America/Shiprock',
  'Navajo',
  'Canada/Eastern',
  'Canada/Central',
  'Canada/Mountain',
  'Canada/Pacific',
  'Canada/Atlantic',
  'EST5EDT',
  'CST6CDT',
  'MST7MDT',
  'PST8PDT',
  'EST',
  'MST',
  'HST',
  'Jamaica',
  'Mexico/General',
  'America/Montreal',
  'Asia/Kolkata',
  'Europe/Kyiv',
  'America/Nuuk',
  'Greenwich',
  'Etc/Greenwich',
  'GB',
  'Eire',
  'Iceland',
  'Portugal',
  'WET',
  'Europe/Belfast',
  'Africa/Timbuktu',
  'Atlantic/Faroe',
  'Etc/GMT0',
  'GMT0',
  'Etc/Universal',
  'Etc/Zulu',
  'UCT',
];
const zones = [...new Set([...Intl.supportedValuesOf('timeZone'), ...LINKS])];
const abbr: string[] = [];
for (const zone of zones) {
  for (const at of ['2026-01-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z']) {
    abbr.push([zone, at, abbreviationAt(at, zone), tryOr(() => offsetAt(at, zone))].join('\t'));
  }
}
writeFileSync(join(here, 'abbreviations.tsv'), `${abbr.join('\n')}\n`);

// 2. The US zones every 59 minutes across both 2027 clock changes and a summer and winter day:
//    the shown event time, the offset form, and the input's local value.
const formats: string[] = [];
const DAYS = [
  ['2027-03-14T00:00:00Z', '2027-03-15T12:00:00Z'],
  ['2027-11-07T00:00:00Z', '2027-11-08T12:00:00Z'],
  ['2026-09-30T00:00:00Z', '2026-10-01T12:00:00Z'],
  ['2026-12-31T00:00:00Z', '2027-01-01T12:00:00Z'],
];
for (const { id } of US_TIME_ZONES) {
  for (const [from, to] of DAYS) {
    for (let t = Date.parse(from); t < Date.parse(to); t += 59 * 60_000) {
      const at = new Date(t).toISOString();
      formats.push(
        [
          id,
          at,
          formatEventTime(at, id),
          tryOr(() => toOffsetDateTime(at, id)),
          toLocalDateTime(at, id),
        ].join('\t'),
      );
    }
  }
}
writeFileSync(join(here, 'formats.tsv'), `${formats.join('\n')}\n`);

// 3. A viewer's own time (FR-023) in a few device zones, set through TZ for each run.
const viewer: string[] = [];
for (const zone of [
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Asia/Kolkata',
  'UTC',
]) {
  process.env.TZ = zone;
  for (const at of ['2026-10-01T23:42:00.000Z', '2026-01-02T03:04:00.000Z']) {
    viewer.push([zone, at, formatViewerTime(at), formatViewerTime(at, { date: true })].join('\t'));
  }
}
writeFileSync(join(here, 'viewer.tsv'), `${viewer.join('\n')}\n`);
