// Spec 022 (tasks T012): times for set-up requests, as RFC 3339 with the venue's own offset, which
// the Backend requires (spec 020: `UTC_OFFSET_MISMATCH` otherwise). Built on Intl.DateTimeFormat,
// not @queuepass/shared, whose build the e2e job never runs.

const parts = (instant: Date, zone: string): Record<string, number> => {
  const out: Record<string, number> = {};
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (const p of f.formatToParts(instant)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
};

/** The zone's offset from UTC at that instant, in minutes (Eastern daylight time: -240). */
export function offsetMinutes(instant: Date, zone: string): number {
  const p = parts(instant, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** `2026-10-31T19:00:00-04:00`: the instant as the venue's clock reads it, with its offset. */
export function zoned(instant: Date, zone: string): string {
  const whole = new Date(Math.floor(instant.getTime() / 60_000) * 60_000);
  const p = parts(whole, zone);
  const off = offsetMinutes(whole, zone);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** The instant a local wall time (`2026-11-05T19:00`) names in the zone; not for skipped times. */
export function atLocal(local: string, zone: string): Date {
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let instant = new Date(guess - offsetMinutes(new Date(guess), zone) * 60_000);
  instant = new Date(guess - offsetMinutes(instant, zone) * 60_000);
  return instant;
}

/** The local date `days` from now in the zone, as `YYYY-MM-DD`. */
export function localDate(zone: string, days = 0): string {
  const p = parts(new Date(Date.now() + days * 86_400_000), zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** iCalendar's UTC form, `20261031T230000Z`. */
export function icsUtc(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The zone's short name at that instant, as the apps show it: `EDT`, `MST`. */
export function abbreviation(instant: Date, zone: string): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
  return f.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** `7:00 PM MST`: a time of day in the zone, as spec 020 shows every event time. */
export function timeOfDay(instant: Date, zone: string): string {
  const p = parts(instant, zone);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad(p.minute)} ${p.hour < 12 ? 'AM' : 'PM'} ${abbreviation(instant, zone)}`;
}

/** `Oct 31, 2026, 7:00 PM EDT`: an event time in its venue's zone (spec 020 FR-021). */
export function eventTime(instant: Date, zone: string): string {
  const p = parts(instant, zone);
  return `${MONTHS[p.month - 1]} ${p.day}, ${p.year}, ${timeOfDay(instant, zone)}`;
}
