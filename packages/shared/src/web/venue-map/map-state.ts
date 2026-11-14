import type { components } from '../../api-schema.js';

/**
 * Spec 038 research R11, R12 (T039): the venue map's state for one event, typed by the contract
 * (Constitution I). The map (`getVenueMap`, and the stream's `venueMap`) gives each section's seats
 * per level and state; a section's seats come one section at a time (`getVenueMapSection`). Both
 * carry the event's `seq` they were read at, and every `seats` change carries its own: a change
 * whose `seq` is not above the map's is already in the map's counts, and one not above a
 * section's is already in that section's seats, so nothing is counted twice, whatever order
 * changes arrive in (FR-023).
 */
export type VenueMap = components['schemas']['VenueMap'];
export type VenueMapSection = components['schemas']['VenueMapSection'];
export type SeatMapChange = components['schemas']['SeatMapChange'];
export type SeatState = components['schemas']['SeatState'];
export type MapLevel = VenueMap['levels'][number];
export type MapSectionSummary = VenueMap['sections'][number];

/** A section's seats as last loaded, kept current. */
export interface LoadedSection {
  section: VenueMapSection;
  /** The `seq` of the last change applied to each seat, by "row/seat". */
  seatSeq: Readonly<Record<string, number>>;
  /** Loaded before the map was read again (a reconnect): shown until loaded again. */
  stale: boolean;
}

export interface MapState {
  /** The map as read, its counts kept current; its `seq` stays the one it was read at. */
  map: VenueMap | null;
  /** The `seq`s above the map's already applied to its counts. */
  applied: readonly number[];
  /** Changes above the map's `seq`, so a section loaded later catches up (newest last). */
  recent: readonly SeatMapChange[];
  /** Loaded sections, by id. */
  sections: Readonly<Record<string, LoadedSection>>;
}

export type MapAction =
  /** The map, read or sent first by the stream: the first, or the one after a reconnect. */
  | { type: 'map'; map: VenueMap }
  | { type: 'change'; change: SeatMapChange }
  | { type: 'section'; section: VenueMapSection }
  | { type: 'reset' };

export const EMPTY_MAP_STATE: MapState = { map: null, applied: [], recent: [], sections: {} };

/** How many changes are kept for sections loaded later; a section's read takes well under this. */
const RECENT_KEPT = 500;

const seatKey = (row: number, seat: number): string => `${row}/${seat}`;

/**
 * One change applied to a section's counts: −1 in `from`, +1 in `state`, for its level. Not held
 * at 0: two changes of one seat may arrive in either order, and the sum is the same only if a count
 * may dip below 0 between them. Readers use `Math.max(0, …)`.
 */
function countChange(map: VenueMap, change: SeatMapChange): VenueMap {
  const sections = map.sections.map((section) => {
    const here = change.changes.filter((c) => c.sectionId === section.sectionId);
    if (here.length === 0) return section;
    let counts = section.counts;
    for (const c of here) {
      if (c.from === c.state) continue;
      if (!counts.some((n) => n.levelId === c.levelId)) {
        counts = [...counts, { levelId: c.levelId, open: 0, reserved: 0, sold: 0, offSale: 0 }];
      }
      counts = counts.map((n) =>
        n.levelId !== c.levelId ? n : { ...n, [c.from]: n[c.from] - 1, [c.state]: n[c.state] + 1 },
      );
    }
    return { ...section, counts };
  });
  return { ...map, sections };
}

/** One change applied to a loaded section's seats, seat by seat, above each seat's last `seq`. */
function seatChange(loaded: LoadedSection, change: SeatMapChange): LoadedSection {
  const { section } = loaded;
  if (change.seq <= section.seq) return loaded;
  const here = change.changes.filter(
    (c) =>
      c.sectionId === section.sectionId &&
      change.seq > (loaded.seatSeq[seatKey(c.row, c.seat)] ?? 0),
  );
  if (here.length === 0) return loaded;
  const seatSeq = { ...loaded.seatSeq };
  for (const c of here) seatSeq[seatKey(c.row, c.seat)] = change.seq;
  const rows = section.rows.map((row) => {
    const inRow = here.filter((c) => c.row === row.number);
    if (inRow.length === 0) return row;
    return {
      ...row,
      seats: row.seats.map((s) => {
        const c = inRow.find((x) => x.seat === s.number);
        return c ? { ...s, state: c.state } : s;
      }),
    };
  });
  return { ...loaded, section: { ...section, rows }, seatSeq };
}

/** Research R12: the venue map's reducer. */
export function mapReducer(state: MapState, action: MapAction): MapState {
  switch (action.type) {
    case 'reset':
      return EMPTY_MAP_STATE;
    case 'map': {
      // The seats shown stay until their section is loaded again (`needsLoad`), so a reconnect
      // never empties the zoomed section under the customer's focus.
      const sections = Object.fromEntries(
        Object.entries(state.sections).map(([id, s]) => [id, { ...s, stale: true }]),
      );
      // A change newer than this map (a read answered after the change came) is still applied.
      const newer =
        state.map?.eventId === action.map.eventId
          ? state.recent.filter((c) => c.seq > action.map.seq).sort((a, b) => a.seq - b.seq)
          : [];
      return newer.reduce<MapState>((s, change) => mapReducer(s, { type: 'change', change }), {
        map: action.map,
        applied: [],
        recent: [],
        sections,
      });
    }
    case 'change': {
      const { map } = state;
      const { change } = action;
      if (!map || change.eventId !== map.eventId) return state;
      const counted = change.seq > map.seq && !state.applied.includes(change.seq);
      const sections = Object.fromEntries(
        Object.entries(state.sections).map(([id, s]) => [id, seatChange(s, change)]),
      );
      return {
        map: counted ? countChange(map, change) : map,
        applied: counted ? [...state.applied, change.seq] : state.applied,
        recent: change.seq > map.seq ? [...state.recent, change].slice(-RECENT_KEPT) : state.recent,
        sections,
      };
    }
    case 'section': {
      if (state.map && action.section.eventId !== state.map.eventId) return state;
      let loaded: LoadedSection = { section: action.section, seatSeq: {}, stale: false };
      const later = state.recent.filter((c) => c.seq > action.section.seq);
      for (const c of [...later].sort((a, b) => a.seq - b.seq)) loaded = seatChange(loaded, c);
      return { ...state, sections: { ...state.sections, [action.section.sectionId]: loaded } };
    }
  }
}

/** Whether a section's seats must be loaded: never loaded, or loaded before the current map. */
export const needsLoad = (state: MapState, sectionId: string): boolean =>
  state.sections[sectionId]?.stale !== false;

/** FR-017: a price filter, low and high in whole dollars, both included. */
export interface PriceRange {
  low: number;
  high: number;
}

/** A decimal-string price in whole cents, never through a floating-point price (Money). */
export function priceCents(price: string): number {
  const [whole, fraction = ''] = price.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

/** FR-017: the filter's full range: the levels' prices, down and up to whole dollars. */
export function priceRangeOf(levels: readonly MapLevel[]): PriceRange | null {
  const prices = levels.flatMap((l) => (l.price === null ? [] : [priceCents(l.price)]));
  if (prices.length === 0) return null;
  return { low: Math.floor(Math.min(...prices) / 100), high: Math.ceil(Math.max(...prices) / 100) };
}

/** Whether a level's price is inside the filter; a level with no price is never. */
export function inRange(price: string | null, range: PriceRange | null): boolean {
  if (price === null) return false;
  if (range === null) return true;
  const c = priceCents(price);
  return c >= range.low * 100 && c <= range.high * 100;
}

/**
 * FR-016 (clarification "section's color"): the level a section is drawn in, its cheapest level
 * (by price, then rank) with open seats inside the filter; `null` when it has none (gray).
 */
export function sectionLevel(
  map: VenueMap,
  section: MapSectionSummary,
  range: PriceRange | null,
): MapLevel | null {
  let best: MapLevel | null = null;
  for (const c of section.counts) {
    if (c.open <= 0) continue;
    const level = map.levels.find((l) => l.levelId === c.levelId);
    if (!level || !inRange(level.price, range)) continue;
    if (
      !best ||
      priceCents(level.price!) < priceCents(best.price!) ||
      (priceCents(level.price!) === priceCents(best.price!) && level.rank < best.rank)
    ) {
      best = level;
    }
  }
  return best;
}

/** A section's open seats inside the filter (every open seat with a price, without one). */
export function openSeatsIn(
  map: VenueMap,
  section: MapSectionSummary,
  range: PriceRange | null,
): number {
  return section.counts.reduce((n, c) => {
    const level = map.levels.find((l) => l.levelId === c.levelId);
    return level && inRange(level.price, range) ? n + Math.max(0, c.open) : n;
  }, 0);
}

/**
 * A price as the map writes it (spec 038 US3: "Courtside $95"): whole dollars without cents,
 * otherwise with them, with thousands separators; from the string's digits (Money).
 */
export function formatPrice(price: string): string {
  const c = priceCents(price);
  const dollars = Math.floor(c / 100).toLocaleString('en-US');
  const rest = c % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, '0')}`;
}
