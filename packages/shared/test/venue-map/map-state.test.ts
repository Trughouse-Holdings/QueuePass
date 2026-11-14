import { describe, it, expect } from 'vitest';
import {
  EMPTY_MAP_STATE,
  formatPrice,
  mapReducer,
  needsLoad,
  openSeatsIn,
  priceRangeOf,
  sectionLevel,
  type MapState,
  type SeatMapChange,
  type VenueMap,
  type VenueMapSection,
} from '../../src/web/venue-map/map-state';

/**
 * Spec 038 research R11, R12 (T031, FR-016, FR-017, FR-023): the venue map's state. A snapshot (the
 * first map, and the one after each reconnect), then `seats` changes: each moves one seat of a
 * level from `from` to `state` in its section's counts, and in a loaded section's seats. A change
 * whose `seq` is not above the map's (for counts) or a section's (for its seats) is already in it.
 */
const L1 = 'l-court';
const L2 = 'l-side';
const L3 = 'l-end';
const L4 = 'l-upper';
const S115 = 's-115';
const S101 = 's-101';
const S301 = 's-301';
const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const counts = (levelId: string, open: number, reserved = 0, sold = 0, offSale = 0) => ({
  levelId,
  open,
  reserved,
  sold,
  offSale,
});

const venueMap = (seq = 10): VenueMap => ({
  eventId: 'e1',
  seq,
  layoutId: 'lay-1',
  layoutName: 'Basketball',
  size: { width: 1000, height: 640 },
  floorKind: 'COURT',
  floorOutline: square,
  levels: [
    { levelId: L1, name: 'Courtside', rank: 1, color: 'violet', price: '95.00' },
    { levelId: L2, name: 'Lower sideline', rank: 2, color: 'blue', price: '60.00' },
    { levelId: L3, name: 'Lower end', rank: 3, color: 'teal', price: '35.00' },
    { levelId: L4, name: 'Upper', rank: 4, color: 'green', price: null },
  ],
  sections: [
    {
      sectionId: S115,
      name: '115',
      outline: square,
      labelAt: [5, 5],
      counts: [counts(L1, 2), counts(L2, 1)],
    },
    { sectionId: S101, name: '101', outline: square, labelAt: [5, 5], counts: [counts(L3, 3)] },
    {
      sectionId: S301,
      name: '301',
      outline: square,
      labelAt: [5, 5],
      counts: [counts(L4, 0, 0, 0, 4)],
    },
  ],
});

const section115 = (seq = 12): VenueMapSection => ({
  eventId: 'e1',
  seq,
  sectionId: S115,
  name: '115',
  rows: [
    {
      number: 1,
      label: 'F',
      seats: [
        { number: 7, label: '7', at: [1, 1], levelId: L1, state: 'open', accessible: false },
        { number: 8, label: '8', at: [3, 1], levelId: L1, state: 'open', accessible: false },
      ],
    },
    {
      number: 2,
      label: 'P',
      seats: [{ number: 7, label: '7', at: [1, 3], levelId: L2, state: 'open', accessible: false }],
    },
  ],
});

const change = (
  seq: number,
  seat: number,
  from: SeatMapChange['changes'][number]['state'],
  state: SeatMapChange['changes'][number]['state'],
  row = 1,
  levelId = L1,
): SeatMapChange => ({
  eventId: 'e1',
  seq,
  changes: [{ sectionId: S115, row, seat, from, state, levelId }],
});

const run = (state: MapState, ...actions: Parameters<typeof mapReducer>[1][]): MapState =>
  actions.reduce(mapReducer, state);
const level = (s: MapState, sectionId: string, levelId: string) =>
  s.map?.sections.find((x) => x.sectionId === sectionId)?.counts.find((c) => c.levelId === levelId);
const seatState = (s: MapState, row: number, seat: number) =>
  s.sections[S115]?.section.rows.find((r) => r.number === row)?.seats.find((x) => x.number === seat)
    ?.state;

describe('mapReducer', () => {
  it('starts empty and takes a snapshot', () => {
    expect(EMPTY_MAP_STATE.map).toBeNull();
    const s = mapReducer(EMPTY_MAP_STATE, { type: 'map', map: venueMap() });
    expect(s.map).toEqual(venueMap());
  });

  it('applies a change to the counts: one less in `from`, one more in `state`, for its level', () => {
    const s = run(
      EMPTY_MAP_STATE,
      { type: 'map', map: venueMap() },
      { type: 'change', change: change(11, 7, 'open', 'reserved') },
    );
    expect(level(s, S115, L1)).toEqual(counts(L1, 1, 1));
    // The other level and sections are untouched.
    expect(level(s, S115, L2)).toEqual(counts(L2, 1));
    expect(level(s, S101, L3)).toEqual(counts(L3, 3));
  });

  it('skips a change whose seq is not above the map’s (already in it), and one seen before', () => {
    const s = run(
      EMPTY_MAP_STATE,
      { type: 'map', map: venueMap(10) },
      { type: 'change', change: change(9, 7, 'open', 'reserved') },
      { type: 'change', change: change(10, 7, 'open', 'reserved') },
      { type: 'change', change: change(11, 8, 'open', 'sold') },
      { type: 'change', change: change(11, 8, 'open', 'sold') },
    );
    expect(level(s, S115, L1)).toEqual(counts(L1, 1, 0, 1));
  });

  it('gives the same counts whatever order the changes arrive in', () => {
    const a = change(11, 7, 'open', 'reserved');
    const b = change(12, 7, 'reserved', 'sold');
    const c = change(13, 7, 'open', 'offSale', 2, L2);
    const base = mapReducer(EMPTY_MAP_STATE, { type: 'map', map: venueMap() });
    const inOrder = run(base, ...[a, b, c].map((x) => ({ type: 'change' as const, change: x })));
    const reversed = run(base, ...[c, b, a].map((x) => ({ type: 'change' as const, change: x })));
    expect(reversed.map).toEqual(inOrder.map);
    expect(level(inOrder, S115, L1)).toEqual(counts(L1, 1, 0, 1));
    expect(level(inOrder, S115, L2)).toEqual(counts(L2, 0, 0, 0, 1));
  });

  it('applies changes to a loaded section’s seats only above the section’s seq', () => {
    const s = run(
      EMPTY_MAP_STATE,
      { type: 'map', map: venueMap(10) },
      { type: 'section', section: section115(12) },
      // In the counts (above 10), already in the section (not above 12).
      { type: 'change', change: change(11, 7, 'open', 'reserved') },
      { type: 'change', change: change(13, 8, 'open', 'sold') },
    );
    expect(seatState(s, 1, 7)).toBe('open');
    expect(seatState(s, 1, 8)).toBe('sold');
    expect(level(s, S115, L1)).toEqual(counts(L1, 0, 1, 1));
  });

  it('keeps each seat at its latest change, whatever the order', () => {
    const base = run(
      EMPTY_MAP_STATE,
      { type: 'map', map: venueMap(10) },
      { type: 'section', section: section115(10) },
    );
    const later = change(12, 7, 'reserved', 'sold');
    const earlier = change(11, 7, 'open', 'reserved');
    expect(
      seatState(
        run(base, { type: 'change', change: later }, { type: 'change', change: earlier }),
        1,
        7,
      ),
    ).toBe('sold');
    expect(
      seatState(
        run(base, { type: 'change', change: earlier }, { type: 'change', change: later }),
        1,
        7,
      ),
    ).toBe('sold');
  });

  it('brings a section loaded later up to date with the changes after its seq', () => {
    const s = run(
      EMPTY_MAP_STATE,
      { type: 'map', map: venueMap(10) },
      { type: 'change', change: change(11, 7, 'open', 'reserved') },
      { type: 'change', change: change(12, 8, 'open', 'reserved') },
      // Read at 11: has seat 7 held, not seat 8.
      {
        type: 'section',
        section: {
          ...section115(11),
          rows: section115().rows.map((r) => ({
            ...r,
            seats: r.seats.map((x) =>
              r.number === 1 && x.number === 7 ? { ...x, state: 'reserved' as const } : x,
            ),
          })),
        },
      },
    );
    expect(seatState(s, 1, 7)).toBe('reserved');
    expect(seatState(s, 1, 8)).toBe('reserved');
  });

  it('on a reconnect replaces the map and asks for the open section again', () => {
    let s = run(
      EMPTY_MAP_STATE,
      { type: 'map', map: venueMap(10) },
      { type: 'section', section: section115(10) },
    );
    expect(needsLoad(s, S115)).toBe(false);
    expect(needsLoad(s, S101)).toBe(true);
    const fresh = venueMap(20);
    fresh.sections[0].counts = [counts(L1, 0, 0, 2), counts(L2, 1)];
    s = mapReducer(s, { type: 'map', map: fresh });
    expect(s.map).toEqual(fresh);
    // The old seats stay shown until the reload, which needsLoad asks for.
    expect(s.sections[S115]).toBeDefined();
    expect(needsLoad(s, S115)).toBe(true);
    // A change from before the new map is not counted again.
    s = mapReducer(s, { type: 'change', change: change(15, 7, 'open', 'sold') });
    expect(level(s, S115, L1)).toEqual(counts(L1, 0, 0, 2));
    s = mapReducer(s, { type: 'section', section: section115(20) });
    expect(needsLoad(s, S115)).toBe(false);
  });

  it('keeps a change newer than a map read again (a refresh answered after the change)', () => {
    const s = run(
      EMPTY_MAP_STATE,
      { type: 'map', map: venueMap(10) },
      { type: 'change', change: change(12, 7, 'open', 'reserved') },
      // Read at 11, before the change at 12, answered after it.
      { type: 'map', map: venueMap(11) },
    );
    expect(level(s, S115, L1)).toEqual(counts(L1, 1, 1));
    // And not counted twice if it comes again.
    expect(
      level(mapReducer(s, { type: 'change', change: change(12, 7, 'open', 'reserved') }), S115, L1),
    ).toEqual(counts(L1, 1, 1));
  });

  it('ignores a change for another event, or before any map', () => {
    expect(
      mapReducer(EMPTY_MAP_STATE, { type: 'change', change: change(11, 7, 'open', 'sold') }),
    ).toEqual(EMPTY_MAP_STATE);
    const s = mapReducer(EMPTY_MAP_STATE, { type: 'map', map: venueMap() });
    const other = { ...change(11, 7, 'open', 'sold'), eventId: 'e2' };
    expect(mapReducer(s, { type: 'change', change: other }).map).toEqual(s.map);
  });
});

describe('the price filter and the colors', () => {
  const map = venueMap();
  const sec = (id: string) => map.sections.find((s) => s.sectionId === id)!;

  it('spans the levels’ prices in whole dollars', () => {
    expect(priceRangeOf(map.levels)).toEqual({ low: 35, high: 95 });
    expect(
      priceRangeOf([
        { ...map.levels[0], price: '59.50' },
        { ...map.levels[1], price: '120.25' },
      ]),
    ).toEqual({ low: 59, high: 121 });
    expect(priceRangeOf([{ ...map.levels[3] }])).toBeNull();
  });

  it('colors a section by its cheapest level with open seats inside the filter', () => {
    expect(sectionLevel(map, sec(S115), { low: 35, high: 95 })?.name).toBe('Lower sideline');
    expect(sectionLevel(map, sec(S115), { low: 70, high: 95 })?.name).toBe('Courtside');
    expect(sectionLevel(map, sec(S101), { low: 35, high: 95 })?.name).toBe('Lower end');
  });

  it('is unavailable (no level) with no open seat inside the filter', () => {
    expect(sectionLevel(map, sec(S101), { low: 50, high: 100 })).toBeNull();
    // Nothing on sale.
    expect(sectionLevel(map, sec(S301), { low: 0, high: 1000 })).toBeNull();
    // A level whose seats are all taken does not count.
    const sold = { ...sec(S115), counts: [counts(L1, 0, 1, 1), counts(L2, 1)] };
    expect(sectionLevel(map, sold, { low: 70, high: 95 })).toBeNull();
  });

  it('counts a section’s open seats inside the filter', () => {
    expect(openSeatsIn(map, sec(S115), { low: 35, high: 95 })).toBe(3);
    expect(openSeatsIn(map, sec(S115), { low: 61, high: 95 })).toBe(2);
    expect(openSeatsIn(map, sec(S301), { low: 0, high: 1000 })).toBe(0);
  });

  it('writes prices short: whole dollars without cents', () => {
    expect(formatPrice('95.00')).toBe('$95');
    expect(formatPrice('59.50')).toBe('$59.50');
    expect(formatPrice('1200.00')).toBe('$1,200');
    expect(formatPrice('0.00')).toBe('$0');
  });
});
