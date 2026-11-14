/**
 * Spec 038: a venue's layouts as contract 2.0.0 serves them, for the Admin event form's tests.
 * Arena: 70 seats; Floor A (Front) and Floor B (Back) 3 rows of 10, Balcony (Upper) 2 rows of 5.
 * Club: 12 seats, one level. Ids are plain strings: the stubs never check them.
 */
import { json } from './helpers/api-stub';
import { VENUE } from './fixtures-005';

const rect = (x: number, y: number, w: number, h: number) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const level = (id: string, name: string, rank: number, color: string, seatCount: number) => ({
  id,
  name,
  rank,
  color,
  seatCount,
});

const section = (
  id: string,
  name: string,
  levelId: string,
  x: number,
  rowCount: number,
  seatsPerRow: number,
) => ({
  id,
  name,
  levelId,
  outline: rect(x, 0, seatsPerRow * 2 + 4, rowCount * 2 + 4),
  labelAt: [x + seatsPerRow + 2, rowCount + 2],
  rowCount,
  seatCount: rowCount * seatsPerRow,
  levelIds: [levelId],
});

export const ARENA_SUMMARY = {
  id: 'l-arena',
  locationId: VENUE.id,
  name: 'Arena',
  source: 'LINES',
  floorKind: 'NONE',
  seatCount: 70,
  sectionCount: 3,
  levelCount: 3,
  eventsUsing: 0,
  locked: false,
};

export const ARENA = {
  ...ARENA_SUMMARY,
  size: { width: 80, height: 10 },
  floorOutline: null,
  levels: [
    level('l-front', 'Front', 1, 'violet', 30),
    level('l-back', 'Back', 2, 'teal', 30),
    level('l-upper', 'Upper', 3, 'blue', 10),
  ],
  sections: [
    section('s-a', 'Floor A', 'l-front', 0, 3, 10),
    section('s-b', 'Floor B', 'l-back', 32, 3, 10),
    section('s-bal', 'Balcony', 'l-upper', 64, 2, 5),
  ],
  latestPrices: {
    eventId: 'e-earlier',
    eventName: 'Earlier game',
    startsAt: '2026-10-01T23:00:00.000Z',
    prices: [
      { levelId: 'l-front', price: '90.00' },
      { levelId: 'l-back', price: '55.00' },
    ],
  },
};

export const CLUB_SUMMARY = {
  ...ARENA_SUMMARY,
  id: 'l-club',
  name: 'Club',
  seatCount: 12,
  sectionCount: 1,
  levelCount: 1,
};

export const CLUB = {
  ...CLUB_SUMMARY,
  size: { width: 20, height: 10 },
  floorOutline: null,
  levels: [level('l-club', 'Club seats', 1, 'orange', 12)],
  sections: [section('s-club', 'Club', 'l-club', 0, 2, 6)],
  latestPrices: null,
};

/** One section of a layout, seat by seat (`getVenueLayoutSection`). */
export function sectionSeats(
  layoutId: string,
  sectionId: string,
  name: string,
  levelId: string,
  rows: number,
  seatsPerRow: number,
) {
  return {
    layoutId,
    sectionId,
    name,
    rows: Array.from({ length: rows }, (_, r) => ({
      number: r + 1,
      label: String(r + 1),
      seats: Array.from({ length: seatsPerRow }, (_, s) => ({
        number: s + 1,
        label: String(s + 1),
        at: [3 + 2 * s, 3 + 2 * r],
        levelId,
        accessible: false,
      })),
    })),
  };
}

export const SECTIONS = {
  's-a': sectionSeats('l-arena', 's-a', 'Floor A', 'l-front', 3, 10),
  's-b': sectionSeats('l-arena', 's-b', 'Floor B', 'l-back', 3, 10),
  's-bal': sectionSeats('l-arena', 's-bal', 'Balcony', 'l-upper', 2, 5),
  's-club': sectionSeats('l-club', 's-club', 'Club', 'l-club', 2, 6),
};

/** The layout routes a form at the venue reads: its layouts, each layout and each section. */
export const layoutRoutes = (venueId: string = VENUE.id) => ({
  [`GET /locations/${venueId}/layouts`]: json([ARENA_SUMMARY, CLUB_SUMMARY]),
  'GET /layouts/l-arena': json(ARENA),
  'GET /layouts/l-club': json(CLUB),
  ...Object.fromEntries(
    Object.values(SECTIONS).map((s) => [
      `GET /layouts/${s.layoutId}/sections/${s.sectionId}`,
      json(s),
    ]),
  ),
});

type SeatState = 'open' | 'reserved' | 'sold' | 'offSale';

/** Spec 038: this event's price per Arena level (Upper on sale too, unlike `latestPrices`). */
const ARENA_PRICES: Record<string, string> = {
  'l-front': '90.00',
  'l-back': '55.00',
  'l-upper': '30.00',
};

/**
 * Spec 038 (research R11): an event's venue map on Arena as `getVenueMap` gives it, read at `seq`,
 * and each section's seats as `getVenueMapSection` does, with the routes that answer them. `states`
 * names the seats that are not open, by "sectionId/row/seat".
 */
export function arenaVenueMap(
  eventId: string,
  { seq = 1, states = {} }: { seq?: number; states?: Record<string, SeatState> } = {},
) {
  const section = (sectionId: keyof typeof SECTIONS) => {
    const s = SECTIONS[sectionId];
    return {
      eventId,
      seq,
      sectionId,
      name: s.name,
      rows: s.rows.map((row) => ({
        ...row,
        seats: row.seats.map((seat) => ({
          ...seat,
          state: states[`${sectionId}/${row.number}/${seat.number}`] ?? ('open' as SeatState),
        })),
      })),
    };
  };
  const ids = ['s-a', 's-b', 's-bal'] as const;
  const map = {
    eventId,
    seq,
    layoutId: ARENA.id,
    layoutName: ARENA.name,
    size: ARENA.size,
    floorKind: 'NONE',
    floorOutline: null,
    levels: ARENA.levels.map((l) => ({
      levelId: l.id,
      name: l.name,
      rank: l.rank,
      color: l.color,
      price: ARENA_PRICES[l.id],
    })),
    sections: ids.map((id) => {
      const drawn = ARENA.sections.find((s) => s.id === id)!;
      const counts = { open: 0, reserved: 0, sold: 0, offSale: 0 };
      for (const row of section(id).rows) for (const seat of row.seats) counts[seat.state] += 1;
      return {
        sectionId: id,
        name: drawn.name,
        outline: drawn.outline,
        labelAt: drawn.labelAt,
        counts: [{ levelId: drawn.levelId, ...counts }],
      };
    }),
  };
  const routes = {
    [`GET /events/${eventId}/venue-map`]: json(map),
    ...Object.fromEntries(
      ids.map((id) => [`GET /events/${eventId}/venue-map/sections/${id}`, json(section(id))]),
    ),
  };
  return { map, section, routes };
}
