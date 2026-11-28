// Spec 037 (tasks T022): one example per API resource, taken from the React Admin app's own test
// fixtures, unchanged but for ids: those fixtures use readable ids ("l-arena"), and the contract's
// ids are UUIDs, so each id string is replaced by a fixed UUID made from it. core/tests/
// contract_types.rs validates each file against its contract schema, then decodes it into the
// generated Rust type. Run from the repository root:
//   npx tsx --tsconfig admin-rust-app/core/tests/fixtures/api/tsconfig.json \
//     admin-rust-app/core/tests/fixtures/api/generate.mts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT, ORDERS, REPORT, VENUE } from '../../../../../admin-app/test/fixtures-005';
import {
  ARENA,
  ARENA_SUMMARY,
  SECTIONS,
  arenaVenueMap,
} from '../../../../../admin-app/test/fixtures-038';
import { DRAWING } from '../../../../../admin-app/test/layout-editor/fixtures';
import { season } from '../../../../../admin-app/test/fixtures-041';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOf(text: string): string {
  if (UUID.test(text)) return text;
  const h = createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const isIdKey = (key: string): boolean => key === 'id' || /Id$/.test(key);

function withUuids(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && isIdKey(key)) return uuidOf(value);
  if (Array.isArray(value)) return value.map((v) => withUuids(v, key.endsWith('Ids') ? 'id' : ''));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withUuids(v, k)]));
  }
  return value;
}

/**
 * The spec 005 fixtures predate fields the contract later made required. Only those are added, with
 * neutral values: the venue's zone (spec 020); on events, no layout, no seated top price, no
 * check-in removal (specs 038, 032), and no Season or presale (spec 041); no pass sales in the
 * sales report and no Season pass on an order (spec 041). Nothing a fixture already has is
 * changed.
 */
function completed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(completed);
  if (!value || typeof value !== 'object') return value;
  const o = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, completed(v)]));
  const add = (k: string, v: unknown) => {
    if (!(k in o)) o[k] = v;
  };
  if ('seatingCapacity' in o && 'address' in o) {
    add('timeZone', 'America/New_York');
    add('timeZoneSource', 'ADDRESS');
  }
  if ('startsAt' in o && 'locationId' in o) {
    add('layoutId', null);
    add('priceMax', null);
    add('checkInDetailsRemovedAt', null);
    // Spec 041 (contract 2.2.0): no Season, so no presale.
    add('season', null);
    add('singleSalesOpenAt', null);
  }
  if ('eventId' in o && 'ticketsSold' in o) {
    add('timeZone', 'America/New_York');
    add('checkInDetailsRemovedAt', null);
  }
  // Spec 041 (R8): no pass sales, per event and in the totals; no order bought on a pass.
  if ('ticketsSold' in o && 'revenue' in o && 'checkedIn' in o) {
    add('passTicketsSold', 0);
    add('passRevenue', '0.00');
  }
  if ('customerUsername' in o && 'tickets' in o) add('seasonPass', null);
  return o;
}

const here = dirname(fileURLToPath(import.meta.url));
const locations = JSON.parse(
  readFileSync(join(here, '../../../../../admin-app/test/fixtures/locations.json'), 'utf8'),
);
const venueMap = arenaVenueMap('event-1', { states: { 's-a/1/1': 'sold', 's-a/1/2': 'reserved' } });

const examples: Record<string, unknown> = {
  Location: VENUE,
  LocationList: locations,
  Event: EVENT,
  SalesReport: REPORT,
  Order: ORDERS[0],
  LayoutSummary: ARENA_SUMMARY,
  LayoutDetail: ARENA,
  LayoutSectionSeats: SECTIONS['s-a'],
  LayoutDrawing: DRAWING,
  VenueMap: venueMap.map,
  VenueMapSection: venueMap.section('s-a'),
  // Spec 041: a Season on sale with a pass sold and a presale (the page's figures and status).
  Season: season({
    status: 'ON_SALE',
    singleSalesOpenAt: '2026-10-01T14:00:00.000Z',
    maxPassesPerCustomer: 4,
    publishedAt: '2026-09-22T12:00:00.000Z',
    salesOpen: true,
    passesSold: 1,
    passRevenue: '100.00',
  }),
};

for (const [name, example] of Object.entries(examples)) {
  writeFileSync(
    join(here, `${name}.json`),
    `${JSON.stringify(completed(withUuids(example)), null, 2)}\n`,
  );
}
console.log(`wrote ${Object.keys(examples).length} examples`);
