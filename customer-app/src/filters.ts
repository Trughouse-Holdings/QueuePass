/**
 * Spec 008 US1 (FR-001–FR-003; research R1, data-model.md): the Events page's filters, held in the
 * page address. Invalid values are dropped here, before any request, so a bad link never makes the
 * Backend answer 400 for something the customer did not type.
 */
export interface Filters {
  /** Name search, trimmed; '' when absent. */
  q: string;
  /** A venue id; only sent once it is known to be one of the listed venues. */
  venue: string;
  /** Whole days, `YYYY-MM-DD`, in the customer's own time zone; '' when absent or invalid. */
  from: string;
  to: string;
  /** Applied in the app: it changes only what is shown (FR-002). */
  hideCancelled: boolean;
}

export const NO_FILTERS: Filters = { q: '', venue: '', from: '', to: '', hideCancelled: false };

/** `YYYY-MM-DD` as a local calendar day, or null when it is not a real date. */
function localDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(y, mo - 1, d);
  return day.getFullYear() === y && day.getMonth() === mo - 1 && day.getDate() === d ? day : null;
}

export function readFilters(params: URLSearchParams): Filters {
  const from = localDay(params.get('from') ?? '') ? (params.get('from') as string) : '';
  let to = localDay(params.get('to') ?? '') ? (params.get('to') as string) : '';
  // An end before the start describes no days at all; drop it rather than fail.
  if (from && to && to < from) to = '';
  return {
    q: (params.get('q') ?? '').trim(),
    venue: params.get('venue') ?? '',
    from,
    to,
    hideCancelled: params.get('hideCancelled') === '1',
  };
}

export function writeFilters(f: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q.trim()) params.set('q', f.q.trim());
  if (f.venue) params.set('venue', f.venue);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.hideCancelled) params.set('hideCancelled', '1');
  return params;
}

export const isFiltered = (f: Filters): boolean =>
  Boolean(f.q || f.venue || f.from || f.to || f.hideCancelled);

/** The `GET /events` query (spec 004's search). `to` is exclusive, so it is the next day. */
export function eventQuery(
  f: Filters,
  venueIds: ReadonlySet<string> | null,
): { q?: string; locationId?: string; from?: string; to?: string } {
  const from = localDay(f.from);
  const to = localDay(f.to);
  return {
    ...(f.q ? { q: f.q } : {}),
    ...(f.venue && venueIds?.has(f.venue) ? { locationId: f.venue } : {}),
    ...(from ? { from: from.toISOString() } : {}),
    ...(to
      ? { to: new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).toISOString() }
      : {}),
  };
}
