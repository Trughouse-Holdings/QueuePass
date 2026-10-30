import { toLocalDateTime } from '@queuepass/shared';

const SLUG_MAX = 60;

/**
 * Research R8: the event name NFKD-normalized, diacritics removed, lower case, every run of
 * anything but `a-z` and `0-9` one hyphen, trimmed, cut to 60 characters; `event` if empty.
 */
export function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX + 1)
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return s || 'event';
}

/**
 * Spec 023 FR-012 (research R8): `attendees-<slug>-<YYYY-MM-DD-HHmm>.<ext>` or
 * `sales-report-<YYYY-MM-DD-HHmm>.<ext>`, the time being the made-at time in the admin's zone,
 * so every download from one page load has the same name.
 */
export function fileName(
  kind: 'attendees' | 'sales-report',
  eventName: string | null,
  madeAt: string,
  zone: string,
  ext: 'csv' | 'xlsx' | 'pdf',
): string {
  const [date, time] = toLocalDateTime(madeAt, zone).split('T');
  const stamp = `${date}-${time.replace(':', '')}`;
  return kind === 'attendees'
    ? `attendees-${slug(eventName ?? '')}-${stamp}.${ext}`
    : `sales-report-${stamp}.${ext}`;
}
