// Spec 037 research R13 (T059): the venue map's drawing parity fixtures. Renders the shared
// venue map's React components unchanged in jsdom (packages/shared/src/web/venue-map/
// {venue-map,section-view,legend,sections-list,layout-preview}.tsx) on fixed inputs, and writes
// every element they draw (tag, attributes, own text, depth) to
// admin-rust-app/core/tests/fixtures/venue_map/, where admin-rust-app/core/tests/venue_map.rs
// checks that the drawing data of `admin_rust_core::seating::venue_map` gives the same elements,
// attribute for attribute and string for string. The Admin event page's map (`EventSeatMap.tsx`:
// colored by state, every seat read-only) is rendered on the Admin tests' own Arena fixture
// (admin-app/test/fixtures-038.ts). Usage, from the repository root:
//
//   npx tsx scripts/venue-map-parity-fixtures.mjs           # writes the expected files
//   npx tsx scripts/venue-map-parity-fixtures.mjs --check   # exits 1 when a committed file differs
//
// The Admin fixtures import `vitest` (for their API stub, which is not used here), and vitest
// refuses to load outside its runner, so `vitest` resolves to an empty module for this run.
import { register } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import prettier from 'prettier';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = join(ROOT, 'admin-rust-app', 'core', 'tests', 'fixtures', 'venue_map');
const check = process.argv.includes('--check');

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(specifier, context, next) {
        if (specifier === 'vitest') {
          return { url: 'data:text/javascript,export const vi = {};', shortCircuit: true };
        }
        return next(specifier, context);
      }`,
    ),
);

// ------------------------------------------------------------------------------ a browser

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const win = dom.window;
win.matchMedia = (query) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
});
win.requestAnimationFrame = () => 0;
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Element',
  'Node',
  'SVGElement',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'WheelEvent',
  'PointerEvent',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? win : win[key],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  value: () => 0,
  configurable: true,
  writable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
// tsx compiles the .tsx files with the classic JSX transform here, which calls
// `React.createElement`.
globalThis.React = React;
const { render, fireEvent, cleanup } = await import('@testing-library/react');
const { VenueMap } = await import('../packages/shared/src/web/venue-map/venue-map.tsx');
const { SectionsList } = await import('../packages/shared/src/web/venue-map/sections-list.tsx');
const { LayoutPreview } = await import('../packages/shared/src/web/venue-map/layout-preview.tsx');
const { arenaVenueMap } = await import('../admin-app/test/fixtures-038.ts');
const { EVENT } = await import('../admin-app/test/fixtures-005.ts');

// ------------------------------------------------------------------------------ helpers

const h = React.createElement;

/** Every element under `root` (not `root` itself), in document order. */
function elements(root) {
  const depthOf = (el) => {
    let d = 0;
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) d += 1;
    return d;
  };
  return [...root.querySelectorAll('*')].map((el) => ({
    tag: el.tagName,
    depth: depthOf(el),
    attrs: Object.fromEntries(
      [...el.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    text: [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(''),
  }));
}

/** One element with its attributes and text, alone. */
const element = (el) =>
  el && {
    tag: el.tagName,
    attrs: Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])),
    text: el.textContent,
  };

const box = (x, y, w = 60, h2 = 40) => [
  [x, y],
  [x + w, y],
  [x + w, y + h2],
  [x, y + h2],
];
const counts = (levelId, open, reserved = 0, sold = 0, offSale = 0) => ({
  levelId,
  open,
  reserved,
  sold,
  offSale,
});
const seat = (number, levelId, state, x, y, label = String(number)) => ({
  number,
  label,
  at: [x, y],
  levelId,
  state,
  accessible: false,
});

// ------------------------------------------------------------------------------ inputs

const L1 = 'l-court';
const L2 = 'l-side';
const L3 = 'l-end';
const L4 = 'l-upper';

/** venue-map.test.tsx's `MAP`. */
const BASKETBALL = {
  eventId: 'e1',
  seq: 10,
  layoutId: 'lay-1',
  layoutName: 'Basketball',
  size: { width: 1000, height: 640 },
  floorKind: 'COURT',
  floorOutline: box(400, 260, 200, 120),
  levels: [
    { levelId: L1, name: 'Courtside', rank: 1, color: 'violet', price: '95.00' },
    { levelId: L2, name: 'Lower sideline', rank: 2, color: 'blue', price: '60.00' },
    { levelId: L3, name: 'Lower end', rank: 3, color: 'teal', price: '35.00' },
    { levelId: L4, name: 'Upper', rank: 4, color: 'green', price: null },
  ],
  sections: [
    {
      sectionId: 's-115',
      name: '115',
      outline: box(420, 400),
      labelAt: [450, 420],
      counts: [counts(L1, 1, 2, 1, 1), counts(L2, 1)],
    },
    {
      sectionId: 's-101',
      name: '101',
      outline: box(100, 300),
      labelAt: [130, 320],
      counts: [counts(L3, 3)],
    },
    {
      sectionId: 's-301',
      name: '301',
      outline: box(420, 40),
      labelAt: [450, 60],
      counts: [counts(L4, 0, 0, 0, 4)],
    },
  ],
};

/** venue-map.test.tsx's `SECTION_115`. */
const SECTION_115 = {
  eventId: 'e1',
  seq: 10,
  sectionId: 's-115',
  name: '115',
  rows: [
    {
      number: 1,
      label: 'F',
      seats: [
        seat(7, L1, 'open', 430, 410),
        seat(8, L1, 'reserved', 432, 410),
        seat(9, L1, 'sold', 434, 410),
        seat(10, L1, 'offSale', 436, 410),
        seat(11, L1, 'reserved', 438, 410),
      ],
    },
    { number: 2, label: 'P', seats: [seat(7, L2, 'open', 430, 420)] },
  ],
};

/**
 * Odd numbers: fractional and turned outlines, a price with cents and one over a thousand, a
 * level missing from the map, counts below 0 (two changes of one seat out of order), and no
 * floor drawn though one is given.
 */
const ODD = {
  eventId: 'e2',
  seq: 3,
  layoutId: 'lay-2',
  layoutName: 'Odd hall',
  size: { width: 333, height: 777 },
  floorKind: 'NONE',
  floorOutline: box(10, 10, 20, 20),
  levels: [
    { levelId: 'l-a', name: 'Box', rank: 1, color: 'orange', price: '1200.50' },
    { levelId: 'l-b', name: 'Stalls', rank: 2, color: 'pink', price: '60.5' },
    { levelId: 'l-c', name: 'Gallery', rank: 3, color: 'brown', price: '0.99' },
    { levelId: 'l-d', name: 'Closed', rank: 4, color: 'lime', price: null },
  ],
  sections: [
    {
      sectionId: 'o-1',
      name: 'Left Box',
      outline: [
        [12.25, 40.5],
        [80.125, 33.333],
        [91.7, 120.01],
        [15, 118.9],
      ],
      labelAt: [49.77, 77.7],
      counts: [counts('l-a', 2, -1, 3, 0), counts('l-b', -2, 1, 0, 1)],
    },
    {
      sectionId: 'o-2',
      name: 'Stalls',
      outline: [
        [100, 300],
        [250.5, 290.25],
        [260, 420.75],
        [95.5, 430],
        [90, 360],
      ],
      labelAt: [171.1, 361.3],
      counts: [counts('l-b', 5, 0, 7, 0), counts('l-c', 1), counts('l-x', 9)],
    },
    {
      sectionId: 'o-3',
      name: 'Gallery',
      outline: box(30.3, 600.6, 270.7, 120.9),
      labelAt: [165.65, 661.05],
      counts: [counts('l-c', 0, 4, 0, 0), counts('l-d', 6, 0, 0, 2)],
    },
    {
      sectionId: 'o-4',
      name: 'Closed',
      outline: box(5, 500, 40, 40),
      labelAt: [25, 520],
      counts: [counts('l-d', 0, 0, 0, 0)],
    },
  ],
};

/** Rows along a slant, a one-seat row, an empty row, uneven gaps, and labels not numbers. */
const ODD_STALLS = {
  eventId: 'e2',
  seq: 3,
  sectionId: 'o-2',
  name: 'Stalls',
  rows: [
    {
      number: 1,
      label: 'AA',
      seats: [
        seat(1, 'l-b', 'open', 110.5, 310.25, '101'),
        seat(2, 'l-b', 'sold', 113.1, 312.35, '102'),
        seat(3, 'l-b', 'offSale', 115.9, 314.15, '103'),
        seat(4, 'l-c', 'reserved', 118.6, 316.05, '104'),
        seat(5, 'l-x', 'open', 121.3, 317.95, '105'),
      ],
    },
    { number: 2, label: 'BB', seats: [seat(1, 'l-c', 'open', 140.7, 350.3)] },
    { number: 3, label: 'CC', seats: [] },
    {
      number: 4,
      label: 'DD',
      seats: [
        seat(1, 'l-b', 'open', 200, 400),
        seat(2, 'l-b', 'open', 200, 400),
        seat(3, 'l-d', 'open', 199.25, 403.5),
      ],
    },
  ],
};

/** Every row a single seat: no gap anywhere, so the spacing falls back to 2. */
const ODD_GALLERY = {
  eventId: 'e2',
  seq: 3,
  sectionId: 'o-3',
  name: 'Gallery',
  rows: [
    { number: 1, label: '1', seats: [seat(1, 'l-c', 'reserved', 60.6, 620.2)] },
    { number: 2, label: '2', seats: [seat(4, 'l-d', 'offSale', 70.1, 640.9)] },
  ],
};

/** The Admin event page's states (admin-app/test/event-seat-map.test.tsx). */
const ADMIN_STATES = { 's-a/1/1': 'sold', 's-a/1/2': 'reserved', 's-bal/1/1': 'offSale' };
const arena = arenaVenueMap(EVENT.id, { states: ADMIN_STATES });
const ARENA_MAP = arena.map;

/** The seat views, by name (the Rust test has the same). */
const SEAT_VIEWS = {
  none: undefined,
  // EventSeatMap's READ_ONLY.
  readOnly: () => ({ disabled: true }),
  // venue-map.test.tsx's `mine`: row 1 seat 11 the customer's.
  mine11: (s) => (s.row === 1 && s.seat === 11 ? { shown: 'mine', disabled: false } : {}),
  // Each shown state in turn, by seat number, with `disabled` given for some.
  cycle: (s) =>
    [
      { shown: 'holding' },
      { shown: 'releasing' },
      { shown: 'mine', disabled: true },
      { shown: 'open', disabled: true },
      { shown: 'sold', disabled: false },
      { shown: 'offSale' },
      { shown: 'reserved' },
      {},
    ][s.seat % 8],
};

// ------------------------------------------------------------------------------ the venue map

const VENUE_MAP_CASES = [
  { name: 'price overview', map: BASKETBALL, colorBy: 'price' },
  { name: 'state overview', map: BASKETBALL, colorBy: 'state' },
  { name: 'state overview zoomed in twice', map: BASKETBALL, colorBy: 'state', zoomIns: 2 },
  {
    name: 'price, section 115 open',
    map: BASKETBALL,
    colorBy: 'price',
    open: 's-115',
    section: SECTION_115,
    seatView: 'mine11',
  },
  {
    name: 'state, section 115 open, read only',
    map: BASKETBALL,
    colorBy: 'state',
    open: 's-115',
    section: SECTION_115,
    seatView: 'readOnly',
  },
  { name: 'price, section 101 loading', map: BASKETBALL, colorBy: 'price', open: 's-101' },
  {
    name: 'price, another section loaded than the one open',
    map: BASKETBALL,
    colorBy: 'price',
    open: 's-101',
    section: SECTION_115,
  },
  {
    name: 'price, an open section not on the map',
    map: BASKETBALL,
    colorBy: 'price',
    open: 's-gone',
    section: SECTION_115,
  },
  { name: 'odd, price', map: ODD, colorBy: 'price' },
  { name: 'odd, state, zoomed in once', map: ODD, colorBy: 'state', zoomIns: 1 },
  {
    name: 'odd, price, stalls open, every shown state',
    map: ODD,
    colorBy: 'price',
    open: 'o-2',
    section: ODD_STALLS,
    seatView: 'cycle',
  },
  {
    name: 'odd, state, gallery open',
    map: ODD,
    colorBy: 'state',
    open: 'o-3',
    section: ODD_GALLERY,
  },
  { name: 'admin arena, state overview', map: ARENA_MAP, colorBy: 'state', seatView: 'readOnly' },
  {
    name: 'admin arena, Floor A open',
    map: ARENA_MAP,
    colorBy: 'state',
    open: 's-a',
    section: arena.section('s-a'),
    seatView: 'readOnly',
  },
];

function venueMapCase(c) {
  const { container, getByRole } = render(
    h(VenueMap, {
      map: c.map,
      colorBy: c.colorBy,
      openSectionId: c.open ?? null,
      section: c.section ?? null,
      onOpenSection() {},
      seatView: SEAT_VIEWS[c.seatView ?? 'none'],
    }),
  );
  for (let i = 0; i < (c.zoomIns ?? 0); i++) {
    fireEvent.click(getByRole('button', { name: 'Zoom in' }));
  }
  const svg = container.querySelector('svg.venue-map__svg');
  const tip = container.querySelector('.venue-map__tip');
  // Each seat's tip, on hover.
  const tips = [...container.querySelectorAll('g.venue-map__seat')].map((g) => {
    fireEvent.mouseEnter(g);
    const text = tip.textContent;
    fireEvent.mouseLeave(g);
    return text;
  });
  const legend = container.querySelector('.venue-map-legend');
  const out = {
    name: c.name,
    input: {
      map: c.map,
      colorBy: c.colorBy,
      openSectionId: c.open ?? null,
      section: c.section ?? null,
      seatView: c.seatView ?? 'none',
      zoomIns: c.zoomIns ?? 0,
    },
    out: {
      svgLabel: svg.getAttribute('aria-label'),
      viewBox: svg.getAttribute('viewBox'),
      backToMap: [...container.querySelectorAll('.venue-map__toolbar button')].some(
        (b) => b.textContent === 'Back to map',
      ),
      loading: element(container.querySelector('p.note')),
      emptyTip: tip.textContent,
      tips,
      legend: elements(legend),
      svg: elements(svg),
    },
  };
  cleanup();
  return out;
}

// ------------------------------------------------------------------------------ Sections list

const SECTIONS_LIST_CASES = [
  { name: 'basketball, none open', map: BASKETBALL, open: null },
  { name: 'basketball, 115 open', map: BASKETBALL, open: 's-115' },
  { name: 'basketball, an open section not on the map', map: BASKETBALL, open: 's-gone' },
  { name: 'odd, Stalls open', map: ODD, open: 'o-2' },
  { name: 'admin arena', map: ARENA_MAP, open: null },
];

function sectionsListCase(c) {
  const { container } = render(
    h(SectionsList, {
      map: c.map,
      openSectionId: c.open,
      onOpenSection() {},
      headingId: 'sections-heading',
    }),
  );
  const out = {
    name: c.name,
    input: { map: c.map, openSectionId: c.open },
    out: elements(container.querySelector('ul.sections-list__sections')),
  };
  cleanup();
  return out;
}

// ------------------------------------------------------------------------------ layout preview

/** layout-preview.test.tsx's `layout`. */
function previewLayout(sectionCount, floor = box(400, 250, 200, 140)) {
  return {
    name: 'Basketball',
    size: { width: 1000, height: 640 },
    floorKind: floor ? 'COURT' : 'NONE',
    floorOutline: floor,
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      id: `s${i}`,
      name: String(101 + i),
      outline: box(20 + (i % 9) * 100, 20 + Math.floor(i / 9) * 100, 30, 20),
      labelAt: [35 + (i % 9) * 100, 30 + Math.floor(i / 9) * 100],
    })),
  };
}

const PREVIEW_CASES = [
  { name: '54 sections', layout: previewLayout(54) },
  { name: 'one section', layout: previewLayout(1) },
  { name: 'no floor', layout: previewLayout(3, null) },
  { name: 'no sections', layout: previewLayout(0) },
  {
    name: 'odd numbers, a floor outline given with kind NONE',
    layout: {
      name: 'Odd hall',
      size: { width: 333, height: 777 },
      floorKind: 'NONE',
      floorOutline: box(10, 10, 20, 20),
      sections: ODD.sections.map((s) => ({
        id: s.sectionId,
        name: s.name,
        outline: s.outline,
        labelAt: s.labelAt,
      })),
    },
  },
  {
    name: 'a ring floor, wider than tall',
    layout: {
      name: 'Ring',
      size: { width: 1234, height: 99 },
      floorKind: 'RING',
      floorOutline: [
        [600.5, 40.25],
        [640.75, 40.25],
        [640.75, 60.125],
        [600.5, 60.125],
      ],
      sections: [{ id: 'r', name: 'Ringside', outline: box(500, 20, 50, 10), labelAt: [525, 25] }],
    },
  },
];

function previewCase(c) {
  const { container } = render(h(LayoutPreview, { layout: c.layout }));
  const svg = container.querySelector('svg');
  const out = {
    name: c.name,
    input: c.layout,
    out: { root: element(svg).attrs, elements: elements(svg) },
  };
  cleanup();
  return out;
}

// ------------------------------------------------------------------------------ write or check

const files = {
  'venue-map.json': VENUE_MAP_CASES.map(venueMapCase),
  'sections-list.json': SECTIONS_LIST_CASES.map(sectionsListCase),
  'layout-preview.json': PREVIEW_CASES.map(previewCase),
};

const options = (await prettier.resolveConfig(join(ROOT, 'package.json'))) ?? {};
let stale = 0;
mkdirSync(OUT_DIR, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  const path = join(OUT_DIR, name);
  const text = await prettier.format(JSON.stringify(data), { ...options, parser: 'json' });
  if (check) {
    let old = '';
    try {
      old = readFileSync(path, 'utf8');
    } catch {
      // Missing counts as different.
    }
    if (old !== text) {
      console.error(`${name} differs from what the TypeScript gives; run without --check`);
      stale += 1;
    }
  } else {
    writeFileSync(path, text);
  }
}
if (check && stale > 0) process.exit(1);
if (!check) console.log(`Wrote ${Object.keys(files).length} files to ${OUT_DIR}`);
dom.window.close();
