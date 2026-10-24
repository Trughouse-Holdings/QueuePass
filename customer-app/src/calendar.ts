import type { MyOrder, OrderEvent } from '@queuepass/shared';

/**
 * Spec 019 (Add to calendar): the one place that writes iCalendar text, formats calendar times,
 * names the file, and decides who is offered it (research R1, R13). No React and no browser-only
 * API, so it runs in Node tests and could move to `packages/shared` unchanged.
 */

/** What the customer adds to their calendar for one event (spec FR-004, FR-007). */
export interface CalendarEntry {
  /** `queuepass-event-<event id>`: the same for every file of the event (research R4). */
  uid: string;
  title: string;
  /** RFC 3339 instants, as the API sends them. */
  startsAt: string;
  endsAt: string;
  location: { name: string; address: string };
}

/** Research R12: the calendar file's MIME type. */
export const ICS_TYPE = 'text/calendar;charset=utf-8';

const CRLF = '\r\n';

/** The entry for an order's event: name, times, venue and address, nothing else (FR-004). */
export function calendarEntry(event: OrderEvent): CalendarEntry {
  return {
    uid: `queuepass-event-${event.id}`,
    title: event.name,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: { name: event.location.name, address: event.location.address },
  };
}

/**
 * Research R5: `YYYYMMDDTHHMMSSZ` from the `getUTC…` methods only, so the device's time zone
 * never enters the file (FR-005). Milliseconds are dropped.
 */
function utc(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Research R14: every event ends after it starts; anything else is a broken input. */
function times(entry: CalendarEntry): { start: string; end: string } {
  const start = new Date(entry.startsAt);
  const end = new Date(entry.endsAt);
  if (!(end.getTime() > start.getTime()))
    throw new Error(`calendar entry ${entry.uid}: the end is not after the start`);
  return { start: utc(start), end: utc(end) };
}

/**
 * Research R6: RFC 5545 TEXT escaping, backslash first. Line breaks become `\n`; every other
 * control character but tab is removed.
 */
function escapeText(s: string): string {
  return (
    s
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\n|\r/g, '\\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000A-\u001F\u007F]/g, '')
  );
}

const encoder = new TextEncoder();

/**
 * Research R7: fold a content line at 75 octets of UTF-8, never inside a character; each
 * continuation line starts with one space and holds at most 74 more octets.
 */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let size = 0;
  // Walks by code point, so a multi-byte character moves whole to the next line.
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > 75) {
      out.push(current);
      current = ' ';
      size = 1;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join(CRLF);
}

/**
 * Research R3: the whole calendar file for one entry, every line ending in CRLF. `now` is the
 * moment it is made (`DTSTAMP`, research R4).
 */
export function icsFile(entry: CalendarEntry, now: Date): string {
  const { start, end } = times(entry);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QueuePass//Customer app//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${entry.uid}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(entry.title)}`,
    `LOCATION:${escapeText(entry.location.name)}\\, ${escapeText(entry.location.address)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map((l) => fold(l) + CRLF).join('');
}

/** Research R8: Google Calendar's "add event" template page. */
const GOOGLE_TEMPLATE = 'https://calendar.google.com/calendar/render?action=TEMPLATE';

/**
 * Research R8, FR-011: Google Calendar's new-entry page, pre-filled with only the title, the UTC
 * times (`dates=<start>/<end>`, no `ctz`), and the location; `URLSearchParams` encodes them.
 */
export function googleCalendarUrl(entry: CalendarEntry): string {
  const { start, end } = times(entry);
  const params = new URLSearchParams({
    text: entry.title,
    dates: `${start}/${end}`,
    location: `${entry.location.name}, ${entry.location.address}`,
  });
  return `${GOOGLE_TEMPLATE}&${params.toString()}`;
}

/**
 * Research R12, FR-009: the event's name in lower case without accents, every run of other
 * characters one `-`, at most 60 characters, then `.ics`; `event.ics` when nothing is left.
 */
export function icsFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${slug || 'event'}.ics`;
}

/**
 * Research R10, FR-002: offered while the event is not cancelled, has not ended (`endsAt` is
 * exclusive), and the order holds a valid ticket, used or not. `nowMs` is when My tickets loaded.
 */
export function calendarEligible(order: MyOrder, nowMs: number): boolean {
  return (
    order.event.status !== 'CANCELLED' &&
    nowMs < Date.parse(order.event.endsAt) &&
    order.tickets.some((t) => t.status === 'VALID')
  );
}
