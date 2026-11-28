import type { Event, Location } from '@queuepass/shared';
import type { Season } from '../src/api/seasons';

/**
 * Spec 041: a venue with a two-level layout, three upcoming games on it, one game on another
 * layout, one general-admission show with ticket types, and Seasons in every status. Fixed dates
 * after `fixTimeBeforeFixtures`' now (2026-09-25).
 */
export const VENUE = {
  id: '6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e',
  name: 'KFC Yum! Center',
  address: '1 ARENA PLAZA, LOUISVILLE, KY 40202',
  street: '1 Arena Plaza',
  city: 'Louisville',
  state: 'KY',
  zip: '40202',
  addressVerified: true,
  seatingCapacity: 22090,
  timeZone: 'America/New_York',
  timeZoneSource: 'ADDRESS',
  createdAt: '2026-09-20T18:57:51.352Z',
  updatedAt: '2026-09-20T18:57:51.352Z',
} as unknown as Location;

export const LAYOUT_ID = '0f8f7a8e-5a39-4c1e-9b7e-2d3c4b5a6f70';
export const OTHER_LAYOUT_ID = '1f8f7a8e-5a39-4c1e-9b7e-2d3c4b5a6f71';
export const LOWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const UPPER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const LAYOUTS = [
  {
    id: LAYOUT_ID,
    locationId: VENUE.id,
    name: 'Basketball',
    source: 'FILE',
    seatCount: 100,
    sectionCount: 2,
    levelCount: 2,
    eventsUsing: 3,
    locked: false,
  },
  {
    id: OTHER_LAYOUT_ID,
    locationId: VENUE.id,
    name: 'Concert',
    source: 'FILE',
    seatCount: 80,
    sectionCount: 1,
    levelCount: 1,
    eventsUsing: 1,
    locked: false,
  },
];

export const LAYOUT_DETAIL = {
  ...LAYOUTS[0],
  levels: [
    { id: LOWER, name: 'Lower', rank: 1, color: 'blue' },
    { id: UPPER, name: 'Upper', rank: 2, color: 'green' },
  ],
  sections: [],
};

const event = (id: string, name: string, startsAt: string, over: Partial<Event> = {}): Event =>
  ({
    id,
    name,
    locationId: VENUE.id,
    location: VENUE,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3_600_000).toISOString(),
    doorsOpenAt: new Date(Date.parse(startsAt) - 3_600_000).toISOString(),
    entryOpensAt: new Date(Date.parse(startsAt) - 7_200_000).toISOString(),
    totalTicketCapacity: 100,
    basePrice: '25.00',
    status: 'SCHEDULED',
    cancelledAt: null,
    reservedSeating: true,
    layoutId: LAYOUT_ID,
    priceMax: '90.00',
    images: [],
    checkInDetailsRemovedAt: null,
    season: null,
    singleSalesOpenAt: null,
    createdAt: VENUE.createdAt,
    updatedAt: VENUE.updatedAt,
    ...over,
  }) as Event;

// 7:00 PM Eastern (EDT, -04:00) on Oct 10, 17 and 24.
export const GAMES = [
  event('e1000000-0000-4000-8000-000000000001', 'Cardinals vs. Miami', '2026-10-10T23:00:00.000Z'),
  event(
    'e1000000-0000-4000-8000-000000000002',
    'Cardinals vs. Virginia',
    '2026-10-17T23:00:00.000Z',
  ),
  event(
    'e1000000-0000-4000-8000-000000000003',
    'Cardinals vs. Syracuse',
    '2026-10-24T23:00:00.000Z',
  ),
];
export const CONCERT = event(
  'e1000000-0000-4000-8000-000000000004',
  'Arena Tour',
  '2026-10-12T00:00:00.000Z',
  {
    layoutId: OTHER_LAYOUT_ID,
  },
);
export const TAKEN = event(
  'e1000000-0000-4000-8000-000000000005',
  'Cardinals vs. Duke',
  '2026-10-20T23:00:00.000Z',
  {
    season: { id: 'f0000000-0000-4000-8000-00000000000f', name: 'Another Season' },
  },
);
export const SHOW = event(
  'e1000000-0000-4000-8000-000000000006',
  'Comedy Night',
  '2026-10-14T00:00:00.000Z',
  {
    layoutId: null,
    reservedSeating: false,
  },
);

export const SEASON_ID = 'c0000000-0000-4000-8000-00000000000c';

export const season = (over: Partial<Season> = {}): Season =>
  ({
    id: SEASON_ID,
    name: 'Spring Hoops',
    sport: 'BASKETBALL',
    team: 'Louisville Cardinals',
    locationId: VENUE.id,
    venueName: VENUE.name,
    timeZone: 'America/New_York',
    layoutId: LAYOUT_ID,
    layoutName: 'Basketball',
    status: 'DRAFT',
    salesEndAt: '2026-10-10T22:00:00.000Z',
    singleSalesOpenAt: null,
    maxPassesPerCustomer: null,
    salesOpen: false,
    publishedAt: null,
    cancelledAt: null,
    events: GAMES.slice(0, 2).map((g) => ({
      id: g.id,
      name: g.name,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      status: 'SCHEDULED',
    })),
    prices: [
      { levelId: LOWER, levelName: 'Lower', tierName: null, price: '100.00' },
      { levelId: UPPER, levelName: 'Upper', tierName: null, price: '60.00' },
    ],
    passesSold: 0,
    passRevenue: '0.00',
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...over,
  }) as Season;
