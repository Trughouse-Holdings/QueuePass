import type { UsState } from './location.js';

/**
 * Spec 020: one time module for the Backend and the three apps (research R11). Every conversion
 * between a venue's local time and an instant, and every formatted event time, goes through
 * here, so the Backend's refusals and the apps' previews cannot disagree (Constitution IV).
 * Built on `Intl` only (Node 22's full ICU, current browsers); no date library.
 */

/**
 * The eight US zones a venue can have, by IANA name, in this order (research R2). Mirrors
 * `UsTimeZone` in contracts/openapi.yaml and the `location_time_zone_known` CHECK; a Backend test
 * keeps the three equal.
 */
export const US_TIME_ZONES = [
  { id: 'America/New_York', name: 'Eastern Time' },
  { id: 'America/Chicago', name: 'Central Time' },
  { id: 'America/Denver', name: 'Mountain Time' },
  { id: 'America/Phoenix', name: 'Arizona Time (no daylight saving)' },
  { id: 'America/Los_Angeles', name: 'Pacific Time' },
  { id: 'America/Anchorage', name: 'Alaska Time' },
  { id: 'America/Adak', name: 'Hawaii-Aleutian Time' },
  { id: 'Pacific/Honolulu', name: 'Hawaii Time' },
] as const;

export type UsTimeZone = (typeof US_TIME_ZONES)[number]['id'];

/** How a venue's zone was set (data-model.md; contract `TimeZoneSource`). */
export type TimeZoneSource = 'ADDRESS' | 'STATE' | 'ADMIN' | 'DEFAULT';

/** Existing venues' zone, and the zone a client assumes when a response has none (FR-006). */
export const DEFAULT_TIME_ZONE: UsTimeZone = 'America/New_York';

const ZONE_IDS: ReadonlySet<string> = new Set(US_TIME_ZONES.map((z) => z.id));

export function isUsTimeZone(value: unknown): value is UsTimeZone {
  return typeof value === 'string' && ZONE_IDS.has(value);
}

/** The zone's shown name ("Eastern Time"). */
export function zoneName(zone: UsTimeZone): string {
  return US_TIME_ZONES.find((z) => z.id === zone)?.name ?? zone;
}

const ET = 'America/New_York';
const CT = 'America/Chicago';
const MT = 'America/Denver';
const AZ = 'America/Phoenix';
const PT = 'America/Los_Angeles';

/**
 * The zones in use in each state and DC, most populous first (research R3). A state with one zone
 * gives every address saved anyway its zone; in the 15 with two, the admin chooses.
 */
export const STATE_TIME_ZONES: Readonly<Record<UsState, readonly UsTimeZone[]>> = {
  AL: [CT],
  AK: ['America/Anchorage', 'America/Adak'],
  AZ: [AZ, MT],
  AR: [CT],
  CA: [PT],
  CO: [MT],
  CT: [ET],
  DE: [ET],
  DC: [ET],
  FL: [ET, CT],
  GA: [ET],
  HI: ['Pacific/Honolulu'],
  ID: [MT, PT],
  IL: [CT],
  IN: [ET, CT],
  IA: [CT],
  KS: [CT, MT],
  KY: [ET, CT],
  LA: [CT],
  ME: [ET],
  MD: [ET],
  MA: [ET],
  MI: [ET, CT],
  MN: [CT],
  MS: [CT],
  MO: [CT],
  MT: [MT],
  NE: [CT, MT],
  NV: [PT, MT],
  NH: [ET],
  NJ: [ET],
  NM: [MT],
  NY: [ET],
  NC: [ET],
  ND: [CT, MT],
  OH: [ET],
  OK: [CT],
  OR: [PT, MT],
  PA: [ET],
  RI: [ET],
  SC: [ET],
  SD: [CT, MT],
  TN: [CT, ET],
  TX: [CT, MT],
  UT: [MT],
  VT: [ET],
  VA: [ET],
  WA: [PT],
  WV: [ET],
  WI: [CT],
  WY: [MT],
};

// ---------------------------------------------------------------- Intl, cached

/** An instant, as a Date, an RFC 3339 string, or milliseconds since the epoch. */
export type InstantLike = Date | string | number;

const toDate = (instant: InstantLike): Date =>
  instant instanceof Date ? instant : new Date(instant);

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One `Intl.DateTimeFormat` per zone and style, `en-US` always (research R11). */
function formatter(
  zone: string | undefined,
  style: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${zone ?? ''}|${style}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { ...options, ...(zone ? { timeZone: zone } : {}) });
    formatters.set(key, f);
  }
  return f;
}

function part(f: Intl.DateTimeFormat, at: Date, type: Intl.DateTimeFormatPartTypes): string {
  return f.formatToParts(at).find((p) => p.type === type)?.value ?? '';
}

// `longOffset` is in every runtime we use but not in TypeScript's ES2022 lib types.
const LONG_OFFSET = { timeZoneName: 'longOffset' } as unknown as Intl.DateTimeFormatOptions;

/** Minutes from UTC at that instant in that zone (`-240` for EDT). */
export function offsetAt(instant: InstantLike, zone: string): number {
  const text = part(formatter(zone, 'offset', LONG_OFFSET), toDate(instant), 'timeZoneName');
  if (text === 'GMT') return 0; // UTC itself
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(text);
  // Review round 2, m4: anything else (before 1883, local mean time such as GMT-04:56:02) is an
  // offset no time can be stated in; unknown, never 0.
  if (!m) throw new RangeError(`No whole-minute UTC offset in ${zone} at that time: ${text}`);
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

/** The zone's abbreviation at that instant (`EDT`); ICU's own fallback is `GMT-4`. */
export function abbreviationAt(instant: InstantLike, zone?: string): string {
  return part(formatter(zone, 'abbr', { timeZoneName: 'short' }), toDate(instant), 'timeZoneName');
}

/** `-04:00` from `-240`. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * The local date and time to the second, `YYYY-MM-DDTHH:mm:ss`. `hourCycle: 'h23'`, never
 * `hour12: false`, which some ICU versions render as `24:00` at midnight (review round 1, m9).
 */
function localParts(instant: Date, zone: string): string {
  const parts = formatter(zone, 'parts', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/** `2026-10-01T19:00`: the local date-time, also a `datetime-local` input's value. */
export function toLocalDateTime(instant: InstantLike, zone: string): string {
  return localParts(toDate(instant), zone).slice(0, 16);
}

/** `2026-10-01`: the local date. */
export function localDate(instant: InstantLike, zone: string): string {
  return localParts(toDate(instant), zone).slice(0, 10);
}

/** `2026-10-01T19:00:00-04:00`: the instant stated in the zone's offset, what clients send. */
export function toOffsetDateTime(instant: InstantLike, zone: string): string {
  const at = toDate(instant);
  return `${localParts(at, zone)}${formatOffset(offsetAt(at, zone))}`;
}

// ---------------------------------------------------------------- local → instant

/** One moment a local time names in a zone. */
export interface Moment {
  instant: Date;
  /** `-04:00` */
  offset: string;
  /** `EDT` */
  abbreviation: string;
}

export type ResolvedLocal =
  | { kind: 'ok'; moment: Moment }
  /** Clocks jump past it; `skippedFrom`/`skippedTo` are the local `HH:mm` of the jump. */
  | { kind: 'skipped'; skippedFrom: string; skippedTo: string }
  /** Clocks fall back over it; `first` is the earlier moment. */
  | { kind: 'repeated'; first: Moment; second: Moment };

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

/** The local time read as if it were UTC, in ms, or null when it is not a real date-time. */
function localAsUtc(local: string): number | null {
  const m = LOCAL_PATTERN.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const ms = Number((m[7] ?? '0').padEnd(3, '0').slice(0, 3));
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  // Date.UTC rolls Feb 30 over to Mar 2; a real date reads back the same.
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function momentAt(instant: Date, zone: string): Moment {
  return {
    instant,
    offset: formatOffset(offsetAt(instant, zone)),
    abbreviation: abbreviationAt(instant, zone),
  };
}

const hhmm = (ms: number): string => new Date(ms).toISOString().slice(11, 16);

/**
 * The moments a local date-time (`YYYY-MM-DDTHH:mm[:ss[.fff]]`) names in a zone (research R11).
 * It reads `local` as if it were UTC (`t0`), takes the zone's offsets a day before and a day after
 * (a US zone changes at most once in two days), and keeps each `t0 − offset` whose own offset is
 * that offset. None: skipped; one: ok; two: repeated, earlier first. Throws a `RangeError` for a
 * malformed or impossible date-time.
 */
export function resolveLocal(local: string, zone: string): ResolvedLocal {
  const t0 = localAsUtc(local);
  if (t0 === null) throw new RangeError(`Not a local date-time: ${local}`);
  const before = offsetAt(t0 - DAY_MS, zone);
  const after = offsetAt(t0 + DAY_MS, zone);
  const found: number[] = [];
  for (const offset of new Set([before, after])) {
    const t = t0 - offset * MINUTE_MS;
    if (offsetAt(t, zone) === offset) found.push(t);
  }
  found.sort((a, b) => a - b);
  if (found.length === 1) return { kind: 'ok', moment: momentAt(new Date(found[0]), zone) };
  if (found.length === 2) {
    return {
      kind: 'repeated',
      first: momentAt(new Date(found[0]), zone),
      second: momentAt(new Date(found[1]), zone),
    };
  }
  // A gap: find the minute the offset changes, between a day before and a day after.
  let lo = t0 - DAY_MS - 12 * 3_600_000; // offset `before`
  let hi = t0 + DAY_MS + 12 * 3_600_000; // offset `after`
  lo = Math.floor(lo / MINUTE_MS);
  hi = Math.ceil(hi / MINUTE_MS);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid * MINUTE_MS, zone) === before) lo = mid;
    else hi = mid;
  }
  const change = hi * MINUTE_MS;
  return {
    kind: 'skipped',
    skippedFrom: hhmm(change + before * MINUTE_MS),
    skippedTo: hhmm(change + after * MINUTE_MS),
  };
}

const OFFSET_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Splits an RFC 3339 date-time with an offset into its local date-time
 * (`2027-11-07T01:30:00`, with the fraction when sent) and its offset in minutes (`Z` is 0), or
 * null when it has no offset or is not a real date-time (research R9).
 */
export function parseOffsetDateTime(s: string): { local: string; offsetMinutes: number } | null {
  const m = OFFSET_DATE_TIME.exec(s);
  if (!m) return null;
  const local = `${m[1]}:${m[2] ?? '00'}${m[3] ?? ''}`;
  if (localAsUtc(local) === null) return null;
  if (m[4] === 'Z') return { local, offsetMinutes: 0 };
  const hours = Number(m[6]);
  const minutes = Number(m[7]);
  if (hours > 23 || minutes > 59) return null;
  const offset = hours * 60 + minutes;
  return { local, offsetMinutes: m[5] === '-' ? -offset : offset };
}

// ---------------------------------------------------------------- formatting

/** `Oct 1, 2026` in the zone. */
export function formatEventDate(instant: InstantLike, zone: string): string {
  const parts = formatter(zone, 'date', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatToParts(toDate(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')} ${get('day')}, ${get('year')}`;
}

/** `7:00 PM`, with plain spaces (ICU puts a narrow no-break space before PM). */
function clock(at: Date, zone: string | undefined): string {
  const parts = formatter(zone, 'clock', {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** `7:00 PM EDT` in the zone. */
export function formatTimeOfDay(instant: InstantLike, zone: string): string {
  const at = toDate(instant);
  return `${clock(at, zone)} ${abbreviationAt(at, zone)}`;
}

/** `Oct 1, 2026, 7:00 PM EDT` in the zone: every event time in every app (FR-021). */
export function formatEventTime(instant: InstantLike, zone: string): string {
  return `${formatEventDate(instant, zone)}, ${formatTimeOfDay(instant, zone)}`;
}

/**
 * A time that belongs to no event, in the viewer's own zone with its abbreviation (FR-023):
 * `4:42 PM PDT`, or `Oct 1, 2026, 4:42 PM PDT` with `{ date: true }`.
 */
export function formatViewerTime(instant: InstantLike, options: { date?: boolean } = {}): string {
  const at = toDate(instant);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = `${clock(at, zone)} ${abbreviationAt(at, zone)}`;
  return options.date ? `${formatEventDate(at, zone)}, ${time}` : time;
}

// ---------------------------------------------------------------- local wall times (R9)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `1:30 AM` from a local date-time (`YYYY-MM-DDTHH:mm…`), with no zone involved. */
export function formatLocalTime(local: string): string {
  const h = Number(local.slice(11, 13));
  const m = local.slice(14, 16);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** `Mar 14, 2027, 2:30 AM` from a local date-time, with no zone involved. */
export function formatLocalDateTime(local: string): string {
  const date = `${MONTHS[Number(local.slice(5, 7)) - 1]} ${Number(local.slice(8, 10))}, ${local.slice(0, 4)}`;
  return `${date}, ${formatLocalTime(local)}`;
}

/**
 * Spec 020 research R9: the one message for a local time a daylight-saving change skips, used by
 * the Backend's LOCAL_TIME_SKIPPED and by the Admin event form before it sends anything.
 * `2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 AM.
 * Choose another time.`
 */
export function skippedTimeMessage(
  local: string,
  zone: UsTimeZone,
  skippedFrom: string,
  skippedTo: string,
): string {
  const day = local.slice(0, 10);
  const date = formatLocalDateTime(local).split(', ').slice(0, 2).join(', ');
  return (
    `${formatLocalTime(local)} on ${date} doesn't exist in ${zoneName(zone)}: clocks jump from ` +
    `${formatLocalTime(`${day}T${skippedFrom}`)} to ${formatLocalTime(`${day}T${skippedTo}`)}. ` +
    'Choose another time.'
  );
}

/**
 * An event's end next to its start (research R9, review round 1 m12): `10:00 PM EDT`, or
 * `Oct 2, 2026, 1:00 AM EDT` when its local date differs from the start's.
 */
export function formatEventEnd(start: InstantLike, end: InstantLike, zone: string): string {
  return localDate(start, zone) === localDate(end, zone)
    ? formatTimeOfDay(end, zone)
    : formatEventTime(end, zone);
}
