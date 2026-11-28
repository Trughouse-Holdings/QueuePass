/**
 * Spec 041 (research R4, R11; FR-002 to FR-006, FR-009, FR-010, FR-017, FR-018): the Season form's
 * pure parts. The checks preview the Backend's rules (the Backend stays authoritative,
 * Constitution IV), keyed by the Backend's own field paths, so `placeSeasonErrors` puts a refusal
 * where a preview would have gone. The Rust Admin app's `core/src/forms/season.rs` mirrors this
 * file case for case.
 */
import {
  formatEventTime,
  resolveLocal,
  skippedTimeMessage,
  toOffsetDateTime,
  type UsTimeZone,
} from '@queuepass/shared';
import type { ApiError } from '../api/client';
import type { SeasonInput, Sport } from '../api/seasons';

/** The sports a Season can be for, in the contract's order, with the words shown. */
export const SPORTS: { value: Sport; label: string }[] = [
  { value: 'BASKETBALL', label: 'Basketball' },
  { value: 'FOOTBALL', label: 'Football' },
  { value: 'BASEBALL', label: 'Baseball' },
  { value: 'SOCCER', label: 'Soccer' },
  { value: 'HOCKEY', label: 'Hockey' },
  { value: 'VOLLEYBALL', label: 'Volleyball' },
];

/** The layout select's value for general admission ('' is nothing chosen yet). */
export const GENERAL_ADMISSION = 'ga';

/** The form as typed. Times are venue-local `YYYY-MM-DDTHH:mm`, or '' when not filled in. */
export interface SeasonDraft {
  name: string;
  locationId: string;
  /** '' (not chosen), `GENERAL_ADMISSION`, or a layout id. */
  layout: string;
  sport: Sport | '';
  team: string;
  salesEndAt: string;
  singleSalesOpenAt: string;
  maxPassesPerCustomer: string;
  eventIds: string[];
  /** Typed prices by price key: a level id (seated), or `tier:<name in lower case>`. */
  prices: Record<string, string>;
}

/** What the checks read besides the form. */
export interface SeasonPreviewContext {
  zone: UsTimeZone;
  /** The chosen events. */
  events: { id: string; name: string; startsAt: string; status: string }[];
  /** The layout's levels (seated). */
  levels: { id: string; name: string; rank: number }[];
  /** The ticket type names offered for a price (general admission), as spelled. */
  tierNames: string[];
  /** A Season on sale, or being put on sale: every level (or at least one name) priced. */
  complete: boolean;
  /** Being put on sale (FR-010): also at least 2 events not cancelled. */
  publishing?: boolean;
}

export const SEASON_MSG = {
  name: "Enter the season's name.",
  nameLength: 'name must be between 1 and 100 characters',
  venue: "Choose a venue first: times are in the venue's local time.",
  layout: 'Choose a layout, or General admission.',
  team: 'Enter the team, or choose no sport.',
  sport: 'Choose the sport, or leave the team blank.',
  teamLength: 'team must be between 1 and 100 characters',
  salesEnd: 'Enter when pass sales end.',
  presaleTime: 'Enter when single tickets go on sale, or leave both its date and time blank.',
  presale: 'Single tickets must go on sale no later than the pass sales end.',
  passes: 'Passes per customer must be a whole number from 1 to 10, or blank for no limit.',
  price: 'Enter a price such as 640.00, at most 99999999.99.',
  twoEvents: 'Choose at least 2 events to put the season on sale.',
  oneName: 'Price at least one ticket type.',
} as const;

/** FR-009: a seated Season's empty price box, as the event form says it (`038`). */
export const levelPriceMessage = (level: string): string => `Give ${level} a price.`;

/** FR-006: the sales end after the first event's start. */
export const salesEndMessage = (eventName: string, start: string, zone: UsTimeZone): string =>
  `Pass sales must end by the start of the first event, ${eventName} (${formatEventTime(start, zone)}).`;

/** The contract's `SeasonPriceInput.price`: at most 8 whole digits, fitting decimal(10,2). */
const PRICE = /^\d{1,8}(\.\d{1,2})?$/;

/** Ticket type names in one order in both Admin apps: their lower-case characters, compared. */
export const byName = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** A general-admission price key for a ticket type name. */
export const tierKey = (name: string): string => `tier:${name.trim().toLowerCase()}`;

/** The price keys the form shows, in order: levels by rank, or the offered names. */
export function priceKeys(
  draft: Pick<SeasonDraft, 'layout'>,
  ctx: Pick<SeasonPreviewContext, 'levels' | 'tierNames'>,
): string[] {
  if (draft.layout === GENERAL_ADMISSION) return ctx.tierNames.map(tierKey);
  return [...ctx.levels].sort((a, b) => a.rank - b.rank).map((l) => l.id);
}

/** A venue-local time as an instant, the first of a repeated one; `null` if none or skipped. */
function instantOf(local: string, zone: UsTimeZone): Date | null {
  if (!local) return null;
  try {
    const r = resolveLocal(local, zone);
    if (r.kind === 'ok') return r.moment.instant;
    if (r.kind === 'repeated') return r.first.instant;
  } catch {
    return null;
  }
  return null;
}

/** A time field's own problem: missing, unreadable, or a local time the clocks skip. */
function timeProblem(
  local: string,
  zone: UsTimeZone,
  missing: string | null,
  unreadable: string,
): string | null {
  if (!local) return missing;
  try {
    const r = resolveLocal(local, zone);
    if (r.kind === 'skipped') return skippedTimeMessage(local, zone, r.skippedFrom, r.skippedTo);
  } catch {
    return unreadable;
  }
  return null;
}

/** Every problem the form can see, by field path (R4). */
export function previewSeason(draft: SeasonDraft, ctx: SeasonPreviewContext): Map<string, string> {
  const errors = new Map<string, string>();
  const name = draft.name.trim();
  if (!name) errors.set('name', SEASON_MSG.name);
  else if (name.length > 100) errors.set('name', SEASON_MSG.nameLength);
  if (!draft.locationId) errors.set('locationId', SEASON_MSG.venue);
  if (!draft.layout) errors.set('layoutId', SEASON_MSG.layout);

  const team = draft.team.trim();
  if (team.length > 100) errors.set('team', SEASON_MSG.teamLength);
  else if (draft.sport && !team) errors.set('team', SEASON_MSG.team);
  else if (!draft.sport && team) errors.set('sport', SEASON_MSG.sport);

  const salesEndProblem = timeProblem(
    draft.salesEndAt,
    ctx.zone,
    SEASON_MSG.salesEnd,
    SEASON_MSG.salesEnd,
  );
  if (salesEndProblem) errors.set('salesEndAt', salesEndProblem);
  const presaleProblem = timeProblem(
    draft.singleSalesOpenAt,
    ctx.zone,
    null,
    SEASON_MSG.presaleTime,
  );
  if (presaleProblem) errors.set('singleSalesOpenAt', presaleProblem);
  const salesEnd = instantOf(draft.salesEndAt, ctx.zone);
  const presale = instantOf(draft.singleSalesOpenAt, ctx.zone);
  if (salesEnd && presale && presale > salesEnd) {
    errors.set('singleSalesOpenAt', SEASON_MSG.presale);
  }
  const live = ctx.events.filter((e) => draft.eventIds.includes(e.id) && e.status !== 'CANCELLED');
  const first = [...live].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (salesEnd && first && salesEnd.getTime() > Date.parse(first.startsAt)) {
    errors.set('salesEndAt', salesEndMessage(first.name, first.startsAt, ctx.zone));
  }

  const most = draft.maxPassesPerCustomer.trim();
  if (most && !(/^\d+$/.test(most) && Number(most) >= 1 && Number(most) <= 10)) {
    errors.set('maxPassesPerCustomer', SEASON_MSG.passes);
  }

  if (ctx.publishing && live.length < 2) errors.set('eventIds', SEASON_MSG.twoEvents);

  const keys = priceKeys(draft, ctx);
  let priced = 0;
  for (const key of keys) {
    const typed = (draft.prices[key] ?? '').trim();
    if (typed && !PRICE.test(typed)) errors.set(`prices.${key}`, SEASON_MSG.price);
    else if (typed) priced += 1;
    else if (ctx.complete && draft.layout !== GENERAL_ADMISSION) {
      const level = ctx.levels.find((l) => l.id === key);
      errors.set(`prices.${key}`, levelPriceMessage(level?.name ?? key));
    }
  }
  if (ctx.complete && draft.layout === GENERAL_ADMISSION && priced === 0) {
    errors.set('prices', SEASON_MSG.oneName);
  }
  return errors;
}

/**
 * Review 041: whether the form still shows the saved Season, so Put on sale publishes what is on
 * screen. Prices compare by their filled boxes, in any order; blanks are no price.
 */
export function sameDraft(a: SeasonDraft, b: SeasonDraft): boolean {
  const filled = (d: SeasonDraft) =>
    Object.entries(d.prices)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => `${k}=${v.trim()}`)
      .sort()
      .join('|');
  return (
    a.name === b.name &&
    a.locationId === b.locationId &&
    a.layout === b.layout &&
    a.sport === b.sport &&
    a.team === b.team &&
    a.salesEndAt === b.salesEndAt &&
    a.singleSalesOpenAt === b.singleSalesOpenAt &&
    a.maxPassesPerCustomer === b.maxPassesPerCustomer &&
    [...a.eventIds].sort().join('|') === [...b.eventIds].sort().join('|') &&
    filled(a) === filled(b)
  );
}

/** The form's fields top to bottom, for focus on the first at fault (FR-017). */
export function fieldOrder(keys: readonly string[]): string[] {
  return [
    'name',
    'locationId',
    'layoutId',
    'sport',
    'team',
    'salesEndAt',
    'singleSalesOpenAt',
    'maxPassesPerCustomer',
    'eventIds',
    ...keys.map((k) => `prices.${k}`),
    'prices',
  ];
}

export function firstErrorKey(
  errors: ReadonlyMap<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of fieldOrder(keys)) if (errors.has(key)) return key;
  for (const key of errors.keys()) return key;
  return null;
}

/** The id of the control a field's error focuses. */
export function focusIdFor(key: string): string {
  if (key === 'salesEndAt' || key === 'singleSalesOpenAt') return `${key}-date`;
  const price = /^prices\.(.+)$/.exec(key);
  if (price) return `price-${price[1]}`;
  return key;
}

/** The request the form sends, and each sent price's key by its index (for `prices.<i>`). */
export function toSeasonInput(
  draft: SeasonDraft,
  ctx: SeasonPreviewContext,
): { input: SeasonInput; priceKeys: string[] } {
  const at = (local: string): string | null => {
    const instant = instantOf(local, ctx.zone);
    return instant ? toOffsetDateTime(instant, ctx.zone) : null;
  };
  const ga = draft.layout === GENERAL_ADMISSION;
  const prices: SeasonInput['prices'] = [];
  const sentKeys: string[] = [];
  for (const key of priceKeys(draft, ctx)) {
    const price = (draft.prices[key] ?? '').trim();
    if (!price) continue;
    if (ga) {
      const name = ctx.tierNames.find((n) => tierKey(n) === key) ?? key.slice(5);
      prices.push({ tierName: name, price });
    } else {
      prices.push({ levelId: key, price });
    }
    sentKeys.push(`prices.${key}`);
  }
  const team = draft.team.trim();
  const most = draft.maxPassesPerCustomer.trim();
  return {
    input: {
      name: draft.name.trim(),
      sport: draft.sport || null,
      team: team || null,
      locationId: draft.locationId,
      layoutId: ga || !draft.layout ? null : draft.layout,
      salesEndAt: at(draft.salesEndAt) ?? draft.salesEndAt,
      singleSalesOpenAt: at(draft.singleSalesOpenAt),
      maxPassesPerCustomer: most ? Number(most) : null,
      eventIds: [...draft.eventIds],
      prices,
    },
    priceKeys: sentKeys,
  };
}

/** Refusals placed beside their fields (`031`), and the rest. */
export interface PlacedSeasonErrors {
  fields: Map<string, string[]>;
  unmapped: string[];
}

/**
 * R4: a refusal's field paths as the form's keys. `eventIds.<i>` all go beside the events;
 * `prices.<i>` names the i-th price sent; `prices.<levelId>` a level's box. A path with an index
 * or an id is left out of the message shown, the field says it.
 */
export function placeSeasonErrors(
  error: ApiError | null,
  sent: { eventIds: readonly string[]; priceKeys: readonly string[] },
  /** The price boxes the form shows (`prices.<key>`); a price path naming none is general. */
  shown?: readonly string[],
): PlacedSeasonErrors {
  const placed: PlacedSeasonErrors = { fields: new Map(), unmapped: [] };
  if (!error) return placed;
  const add = (key: string, message: string) =>
    placed.fields.set(key, [...(placed.fields.get(key) ?? []), message]);
  const keyOf = (path: string): string | null => {
    if (/^eventIds(\.\d+)?$/.test(path)) return 'eventIds';
    // A sent entry by its index, or one of its fields (`prices.<i>.price`, review).
    const index = /^prices\.(\d+)(\.\w+)?$/.exec(path);
    if (index) return sent.priceKeys[Number(index[1])] ?? null;
    if (path === 'prices') return path;
    if (/^prices\..+$/.test(path)) return !shown || shown.includes(path) ? path : null;
    if (
      /^(name|locationId|layoutId|sport|team|salesEndAt|singleSalesOpenAt|maxPassesPerCustomer)$/.test(
        path,
      )
    ) {
      return path;
    }
    return null;
  };
  const field = error.details?.field;
  if (typeof field === 'string') {
    const key = keyOf(field);
    if (key) add(key, error.envelope.error.message);
    else placed.unmapped.push(error.envelope.error.message);
    return placed;
  }
  const fields = error.details?.fields;
  if (Array.isArray(fields)) {
    for (const entry of fields) {
      if (typeof entry !== 'string') continue;
      const space = entry.indexOf(' ');
      const head = space === -1 ? entry : entry.slice(0, space);
      const key = keyOf(head);
      if (!key) placed.unmapped.push(entry);
      else {
        // The entry's own field keeps its name ("price must be …"); an index or id goes.
        const field = /^prices\.\d+\.(\w+)$/.exec(head)?.[1];
        const rest = entry.slice(space + 1);
        add(key, field ? `${field} ${rest}` : head.includes('.') ? rest : entry);
      }
    }
    return placed;
  }
  if (error.envelope.error.message) placed.unmapped.push(error.envelope.error.message);
  return placed;
}

/** An event as the picker reads it (`Event` from `listEvents`). */
export interface PickerEvent {
  id: string;
  name: string;
  locationId: string;
  layoutId?: string | null;
  status: string;
  startsAt: string;
  season?: { id: string; name: string } | null;
}

/**
 * R11 (US1 scenario 1): the events a Season can take: at its venue, on its layout (or general
 * admission), scheduled, not started, and in no other Season; plus those it has already (`keep`),
 * which stay listed though cancelled or started since. By start.
 */
export function pickableEvents<E extends PickerEvent>(
  events: readonly E[],
  opts: {
    locationId: string;
    layoutId: string | null;
    seasonId: string | null;
    now: number;
    keep: readonly string[];
  },
): E[] {
  return events
    .filter(
      (e) =>
        opts.keep.includes(e.id) ||
        (e.locationId === opts.locationId &&
          (e.layoutId ?? null) === opts.layoutId &&
          e.status === 'SCHEDULED' &&
          Date.parse(e.startsAt) > opts.now &&
          (!e.season || e.season.id === opts.seasonId)),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

/** FR-018: a Season's status as the list and its page say it. */
export function seasonStatusText(
  season: {
    status: 'DRAFT' | 'ON_SALE' | 'CANCELLED';
    salesEndAt: string;
    singleSalesOpenAt: string | null;
    timeZone: string;
  },
  now: number,
): string {
  if (season.status === 'DRAFT') return 'Draft';
  if (season.status === 'CANCELLED') return 'Cancelled';
  if (now >= Date.parse(season.salesEndAt)) return 'Sales ended';
  if (season.singleSalesOpenAt && now < Date.parse(season.singleSalesOpenAt)) {
    return `Presale until ${formatEventTime(season.singleSalesOpenAt, season.timeZone)}`;
  }
  return 'On sale';
}

/** FR-018: "Basketball · Louisville Cardinals", or a dash for a Season with no sport. */
export function sportTeamText(season: { sport?: Sport | null; team?: string | null }): string {
  const sport = SPORTS.find((s) => s.value === season.sport)?.label;
  return sport && season.team ? `${sport} · ${season.team}` : '—';
}
