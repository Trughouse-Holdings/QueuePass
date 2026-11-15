// Spec 037 research R13 (T031): the seat-map parity fixtures. Imports the TypeScript seat-map
// geometry and pan and zoom unchanged (packages/shared/src/layout-geometry.ts, seating.ts, and
// web/venue-map/{map-geometry.ts,use-pan-zoom.ts,venue-map.tsx}), runs them on fixed inputs, and
// writes what they give to admin-rust-app/core/tests/fixtures/seating/expected/, where
// admin-rust-app/core/tests/seating_geometry.rs checks that the Rust ports give the same: path
// strings byte for byte, numbers to the same float. Usage, from the repository root:
//
//   npx tsx scripts/seat-map-parity-fixtures.mjs           # writes the expected files
//   npx tsx scripts/seat-map-parity-fixtures.mjs --check   # exits 1 when a committed file differs
//
// Logic the React code writes inline (the keys, the wheel, a section's zoom target, the
// animation, the drag, the label size, the map's shape) is not copied here: it is driven through
// the real `usePanZoom` hook and the real `VenueMap` component in jsdom, and what they set is
// written down. Every input is fixed and nothing reads the clock, so each run writes the same
// bytes. Numbers JSON cannot hold (-0, NaN, ±Infinity) are written as the strings "-0", "NaN",
// "Infinity", and "-Infinity"; the inputs of the number formatting cases are the doubles' bits.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import prettier from 'prettier';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = join(ROOT, 'admin-rust-app', 'core', 'tests', 'fixtures', 'seating', 'expected');
const check = process.argv.includes('--check');

// ------------------------------------------------------------------------------ a browser, for
// the hook and the component: jsdom, a controllable clock and frame queue, and the motion setting.

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const win = dom.window;
let reducedMotion = false;
win.matchMedia = (query) => ({
  matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
});
let now = 0;
let frames = [];
const requestFrame = (cb) => {
  frames.push(cb);
  return frames.length;
};
win.requestAnimationFrame = requestFrame;
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
  value: requestFrame,
  configurable: true,
  writable: true,
});
Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
// tsx compiles the .tsx files with the classic JSX transform here (no tsconfig at the root), which
// calls `React.createElement`.
globalThis.React = React;
const { act, render, renderHook, fireEvent, cleanup } = await import('@testing-library/react');
const geometry = await import('../packages/shared/src/layout-geometry.ts');
const seating = await import('../packages/shared/src/seating.ts');
const mapGeometry = await import('../packages/shared/src/web/venue-map/map-geometry.ts');
const panZoom = await import('../packages/shared/src/web/venue-map/use-pan-zoom.ts');
const venueMap = await import('../packages/shared/src/web/venue-map/venue-map.tsx');

// ------------------------------------------------------------------------------ helpers

/** A number JSON can hold as itself, else its name. */
const enc = (v) => {
  if (typeof v === 'number') {
    if (Object.is(v, -0)) return '-0';
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    return v;
  }
  if (Array.isArray(v)) return v.map(enc);
  if (v === undefined) return null;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  }
  return v;
};

/** A call's result, or the error it throws (its message, and a `BlockError`'s problems). */
const run = (f) => {
  try {
    return { out: f() };
  } catch (e) {
    return { error: e instanceof geometry.BlockError ? { problems: e.problems } : e.message };
  }
};

/** One case: the function's TypeScript name, its arguments, and what it gave. */
const call = (fn, args, f) => enc({ fn, args, ...run(f) });

/** A seeded generator, so the "random" numbers are the same on every run. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const bitsOf = (n) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};

const values = (over = {}) => ({
  rows: 3,
  seatsPerRow: [4],
  rowLabels: 'LETTERS',
  firstRow: 'A',
  firstSeat: 1,
  direction: 'LEFT_TO_RIGHT',
  curve: 0,
  ...over,
});

/** A straight block of rows (seat counts), row k at y = -2k, centered on x = 0. */
const straight = (counts) =>
  counts.map((n, k) => Array.from({ length: n }, (_, i) => [(i - (n - 1) / 2) * 2, -2 * k]));

/** The seats of a generated block, placed, as rows of points. */
const seatsOf = (v, origin = [0, 0], angle = 0) =>
  geometry
    .placeBlock(geometry.generateBlock(v), origin, angle)
    .rows.map((r) => r.seats.map((s) => s.at));

// ------------------------------------------------------------------------------ layout geometry

function layoutGeometryCases() {
  const cases = [];
  const pts = [
    [1, 2],
    [3, 4],
    [-2.5, 7.25],
    [0.1, 0.2],
  ];
  for (const [dx, dy] of [
    [10, -1],
    [0.1, 0.2],
    [-3.3, 1e-9],
  ]) {
    cases.push(call('moveBy', [pts, dx, dy], () => geometry.moveBy(pts, dx, dy)));
  }

  const turned = [
    [1, 0],
    [12, 5],
    [-4.5, 3.25],
    [100, 50],
  ];
  for (const [origin, degrees] of [
    [[0, 0], 90],
    [[10, 5], -90],
    [[0, 0], 180],
    [[0, 0], 270],
    [[0, 0], 360],
    [[0, 0], 45],
    [[0, 0], 30],
    [[2, 3], 15],
    [[2, 3], 37.5],
    [[-1, 4], -123.4],
    [[50, 50], 0.1],
    [[0, 0], 0],
  ]) {
    cases.push(
      call('turnAbout', [turned, origin, degrees], () =>
        geometry.turnAbout(turned, origin, degrees),
      ),
    );
  }

  for (const degrees of [
    -180, 190, 360, -190, 180, 45, -725, 0, 539.9, -0.5, 1e-10, 720.25, -360, 179.99, -179.99,
  ]) {
    cases.push(call('normalizeAngle', [degrees], () => geometry.normalizeAngle(degrees)));
  }

  // outlineAround: rows given point by point, or as a block the Rust test generates itself (the
  // generator is checked case by case below), so the file stays small.
  const rowsCases = [
    straight([4, 4, 4]),
    straight([4, 6, 4]),
    straight([5]),
    [[[10, 20]]],
    [[[0, 0]], [[0, -2]], [[0, -4]]],
    [[[10, 10]], [[10, 10]]],
    [
      [
        [10, 10],
        [10, 10],
      ],
    ],
    [[[0, 0]], ...straight([1, 5]).slice(1)],
    [geometry.turnAbout(straight([3])[0], [0, 0], 90)],
    [geometry.turnAbout(straight([3])[0], [0, 0], 33)],
    straight([2, 0, 3]),
    [],
    [[], []],
    straight([7, 5, 3, 1]),
  ];
  for (const rows of rowsCases) {
    cases.push(call('outlineAround', [{ rows }], () => geometry.outlineAround(rows)));
  }
  for (const [v, origin, angle] of [
    [values({ rows: 12, seatsPerRow: [20], curve: 40 }), [0, 0], 0],
    [values({ rows: 100, seatsPerRow: [30], curve: 30 }), [0, 0], 0],
    [values({ rows: 3, seatsPerRow: [200], curve: 120 }), [0, 0], 0],
    [values({ rows: 8, seatsPerRow: [10, 12, 14, 16, 18, 20, 22, 24], curve: 60 }), [0, 0], 0],
    [values({ rows: 5, seatsPerRow: [12], curve: 25 }), [250, 180], 37.5],
    [values({ rows: 20, seatsPerRow: [16], curve: 0 }), [400, 300], -90],
    [values({ rows: 40, seatsPerRow: [50], curve: 90 }), [1200, 900], 15],
  ]) {
    cases.push(
      call('outlineAround', [{ block: v, origin, angle }], () =>
        geometry.outlineAround(seatsOf(v, origin, angle)),
      ),
    );
  }

  for (const [style, first, count] of [
    ['LETTERS', 'A', 30],
    ['LETTERS', 'Y', 3],
    ['LETTERS', 'ZZ', 2],
    ['LETTERS', 'b', 2],
    ['LETTERS', ' c ', 3],
    ['LETTERS', 'A', 0],
    ['LETTERS', 'ZZZZZ', 1],
    ['LETTERS', 'ZZZZZ', 2],
    ['LETTERS', 'AB', 2],
    ['LETTERS', '', 1],
    ['LETTERS', 'ß', 2],
    ['LETTERS', 'aaa', 4],
    ['LETTERS', '1', 1],
    ['NUMBERS', '99', 2],
    ['NUMBERS', '007', 3],
    ['NUMBERS', ' 12 ', 2],
    ['NUMBERS', '99999', 1],
    ['NUMBERS', '99999', 2],
    ['NUMBERS', '1.5', 1],
    ['NUMBERS', '', 1],
    ['NUMBERS', 'A', 1],
    ['NUMBERS', '123456', 1],
  ]) {
    cases.push(
      call('rowLabels', [style, first, count], () => geometry.rowLabels(style, first, count)),
    );
  }

  const blockValues = [
    values(),
    values({ rows: 0 }),
    values({ rows: 101 }),
    values({ rows: 2.5 }),
    values({ rows: NaN }),
    values({ rows: -3 }),
    values({ seatsPerRow: [] }),
    values({ seatsPerRow: [0] }),
    values({ seatsPerRow: [201] }),
    values({ seatsPerRow: [4, 4] }),
    values({ seatsPerRow: [4, 2.5, 6] }),
    values({ seatsPerRow: [NaN] }),
    values({ seatsPerRow: [4, 6, 8] }),
    values({ seatsPerRow: [0, 201, 4] }),
    values({ rows: NaN, seatsPerRow: [4, 4] }),
    values({ rows: 101, seatsPerRow: [4, 4] }),
    values({ firstRow: 'AB' }),
    values({ firstRow: '' }),
    values({ rowLabels: 'NUMBERS', firstRow: 'A' }),
    values({ rowLabels: 'NUMBERS', firstRow: '99998', rows: 3 }),
    values({ rows: 30, firstRow: 'ZZZZ' }),
    values({ rows: 101, firstRow: 'AB' }),
    values({ rows: 0, firstRow: 'ZZZZZ' }),
    values({ firstSeat: 0 }),
    values({ firstSeat: 10000 }),
    values({ firstSeat: 9999 }),
    values({ firstSeat: 1.5 }),
    values({ firstSeat: NaN }),
    values({ curve: -1 }),
    values({ curve: 121 }),
    values({ curve: NaN }),
    values({ curve: Infinity }),
    values({ curve: 120 }),
    values({ curve: 0.5 }),
    values({ direction: 'RIGHT_TO_LEFT', firstSeat: 101 }),
    values({ rows: 0, seatsPerRow: [], firstRow: '', firstSeat: 0, curve: 200 }),
  ];
  for (const v of blockValues) cases.push(call('checkBlock', [v], () => geometry.checkBlock(v)));

  for (const v of [
    values(),
    values({ seatsPerRow: [4, 6, 8] }),
    values({ seatsPerRow: [4, 6] }),
    values({ rows: 2.5 }),
    values({ rows: NaN }),
    values({ rows: 1, seatsPerRow: [7, 8, 9] }),
  ]) {
    cases.push(call('seatCounts', [v], () => geometry.seatCounts(v)));
  }

  const generated = [
    values(),
    values({ rows: 2, seatsPerRow: [4, 6] }),
    values({ seatsPerRow: [20, 20, 20], curve: 40 }),
    values({ rows: 2, seatsPerRow: [1], curve: 120 }),
    values({ rows: 1, seatsPerRow: [4], firstSeat: 101, direction: 'RIGHT_TO_LEFT' }),
    values({ rows: 4, seatsPerRow: [5], curve: 60 }),
    values({ rows: 3, rowLabels: 'NUMBERS', firstRow: '9', seatsPerRow: [3, 2, 1] }),
    values({ rows: 2, seatsPerRow: [6], curve: 0.5 }),
    values({ rows: 3, seatsPerRow: [200], curve: 120 }),
    values({ rows: 6, seatsPerRow: [9, 10, 11, 12, 13, 14], curve: 33.3, firstRow: 'x' }),
    values({ rows: 101 }),
    values({ firstRow: 'AB', curve: 121 }),
  ];
  for (const v of generated) {
    cases.push(call('generateBlock', [v], () => geometry.generateBlock(v)));
  }

  for (const [v, origin, angle] of [
    [values({ rows: 1, seatsPerRow: [3] }), [100, 50], 90],
    [values({ rows: 3, seatsPerRow: [6], curve: 40 }), [250.5, 80.25], 37.5],
    [values({ rows: 2, seatsPerRow: [4, 5] }), [10, 10], -15],
    [values({ rows: 2, seatsPerRow: [4] }), [0, 0], 0],
    [values({ rows: 4, seatsPerRow: [8], curve: 90 }), [333.3, 444.4], 180],
    [values({ rows: 2, seatsPerRow: [3], curve: 10 }), [1, 2], -270.5],
  ]) {
    const block = geometry.generateBlock(v);
    cases.push(
      call('placeBlock', [{ block: v }, origin, angle], () =>
        geometry.placeBlock(block, origin, angle),
      ),
    );
  }
  return cases;
}

// ------------------------------------------------------------------------------ map geometry

function mapGeometryCases() {
  const cases = [];
  const square = [
    [10, 20],
    [50, 20],
    [50, 60],
    [10, 60],
  ];
  const ell = [
    [0, 0],
    [20, 0],
    [20, 10],
    [10, 10],
    [10, 20],
    [0, 20],
  ];
  const odd = [
    [0.1 + 0.2, 1e21],
    [1e-7, 123.456],
    [-5, 0.000001],
    [1 / 3, 2 / 3],
    [123456789.123, -0.5],
  ];
  const outline = geometry.outlineAround(
    seatsOf(values({ rows: 6, seatsPerRow: [10], curve: 40 })),
  );
  const placed = geometry.outlineAround(
    seatsOf(values({ rows: 4, seatsPerRow: [7], curve: 15 }), [321.5, 123.25], 22.5),
  );
  const shapes = [
    square,
    [
      [0.5, 1.25],
      [3, 4],
      [5, 0],
    ],
    ell,
    [...ell].reverse(),
    [
      [0, 0],
      [10, 0],
      [20, 0],
    ],
    odd,
    outline,
    placed,
    [[7, 8]],
  ];
  for (const s of shapes) cases.push(call('outlinePath', [s], () => mapGeometry.outlinePath(s)));
  cases.push(call('outlinePath', [[]], () => mapGeometry.outlinePath([])));
  for (const s of shapes) cases.push(call('bounds', [s], () => mapGeometry.bounds(s)));
  for (const s of shapes) cases.push(call('centroid', [s], () => mapGeometry.centroid(s)));
  for (const s of shapes) {
    for (const margin of [undefined, 0, 10, 2.5]) {
      cases.push(call('sectionViewBox', [s, margin], () => mapGeometry.sectionViewBox(s, margin)));
    }
  }
  return cases;
}

// ------------------------------------------------------------------------------ pan and zoom

const FIT = { x: 0, y: 0, width: 1000, height: 640 };
const RECT = { left: 0, top: 0, width: 1000, height: 640 };
/** A box of another shape, set off the page's corner: the drawing is centered in it (meet). */
const OFFSET_RECT = { left: 10, top: 20, width: 800, height: 600 };

function panZoomMathCases() {
  const cases = [];
  for (const [b, margin] of [
    [{ x: 100, y: 50, width: 40, height: 20 }, 4],
    [{ x: 100, y: 50, width: 40, height: 20 }, undefined],
    [{ x: 0.1, y: 0.2, width: 0.3, height: 1e-7 }, 2.5],
  ]) {
    cases.push(call('fitView', [b, margin], () => panZoom.fitView(b, margin)));
  }
  const half = panZoom.zoomAt(FIT, 2, [500, 320], FIT);
  const odd = { x: 123.4, y: 56.7, width: 333.3, height: 213.312 };
  for (const v of [FIT, half, odd])
    cases.push(call('zoomOf', [v, FIT], () => panZoom.zoomOf(v, FIT)));
  for (const [v, factor, at, max] of [
    [FIT, 2, [250, 160], undefined],
    [FIT, 0.5, [500, 320], undefined],
    [FIT, 1000, [500, 320], undefined],
    [FIT, 1.5, [123.4, 567.8], undefined],
    [half, 1 / 1.5, [400, 300], undefined],
    [half, 1 / 3, [400, 300], undefined],
    [odd, 1.1, [200, 100], undefined],
    [FIT, 100, [10, 10], 10],
    [odd, Math.exp(500 * 0.002), [300.5, 200.25], undefined],
  ]) {
    cases.push(
      call('zoomAt', [v, factor, at, FIT, max], () => panZoom.zoomAt(v, factor, at, FIT, max)),
    );
  }
  for (const [v, dx, dy] of [
    [half, 100, -50],
    [half, 10_000, 10_000],
    [half, -10_000, -10_000],
    [odd, 0.1, 0.2],
    [FIT, 5, 5],
  ]) {
    cases.push(call('panBy', [v, dx, dy, FIT], () => panZoom.panBy(v, dx, dy, FIT)));
  }
  const wide = { left: 0, top: 0, width: 2560, height: 640 };
  for (const [v, r, p] of [
    [FIT, RECT, [500, 320]],
    [FIT, wide, [780, 0]],
    [FIT, wide, [1780, 640]],
    [FIT, OFFSET_RECT, [333, 444]],
    [odd, OFFSET_RECT, [17.5, 600.25]],
    [half, { left: 3, top: 4, width: 375, height: 812 }, [100, 400]],
  ]) {
    cases.push(call('clientToMap', [v, r, p], () => panZoom.clientToMap(v, r, p)));
  }
  for (const [v, r, before, after] of [
    [
      FIT,
      RECT,
      [
        [400, 300],
        [600, 300],
      ],
      [
        [300, 300],
        [700, 300],
      ],
    ],
    [
      half,
      OFFSET_RECT,
      [
        [200, 210],
        [260, 330],
      ],
      [
        [190, 200],
        [275, 345],
      ],
    ],
    [
      half,
      OFFSET_RECT,
      [
        [200, 210],
        [200, 210],
      ],
      [
        [180, 200],
        [220, 220],
      ],
    ],
    [
      FIT,
      RECT,
      [
        [100, 100],
        [300, 100],
      ],
      [
        [150, 100],
        [250, 100],
      ],
    ],
  ]) {
    cases.push(
      call('pinchView', [v, FIT, r, before, after], () =>
        panZoom.pinchView(v, FIT, r, before, after),
      ),
    );
  }
  return cases;
}

/** The real hook on an SVG of `rect`'s size; `fit` its map's fit. */
function mountHook(fit, rect) {
  const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.getBoundingClientRect = () => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  });
  win.document.body.append(svg);
  const hook = renderHook(() => panZoom.usePanZoom(fit));
  act(() => hook.result.current.ref(svg));
  return { ...hook, svg };
}

const state = (pz) => ({ view: pz.view, viewBox: pz.viewBox, zoom: pz.zoom });
const pointer = (pointerId, clientX, clientY) => ({
  pointerId,
  clientX,
  clientY,
  button: 0,
  isPrimary: pointerId === 1,
  currentTarget: { setPointerCapture() {} },
});

/**
 * The hook's inline logic, case by case, as the hook sets it: the Rust test computes each from
 * the starting view with `key_action`, `wheel_factor`, `zoom_to_target`, `animation_frame`,
 * `is_drag`, `drag_pan`, and `view_box`.
 */
function panZoomHookCases() {
  const cases = [];
  reducedMotion = false;
  frames = [];

  // Keys, from the fit and from a view zoomed in twice and panned off center.
  for (const keys of [[], ['+', '+', 'ArrowRight', 'ArrowDown']]) {
    for (const k of [
      '+',
      '=',
      '-',
      '−',
      '_',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Tab',
      'Enter',
      ' ',
      'a',
      'PageUp',
    ]) {
      const { result, unmount } = mountHook(FIT, OFFSET_RECT);
      const press = (key) => {
        let prevented = false;
        act(() => result.current.onKeyDown({ key, preventDefault: () => (prevented = true) }));
        return prevented;
      };
      for (const key of keys) press(key);
      const start = state(result.current);
      const prevented = press(k);
      cases.push(
        enc({ fn: 'keyAction', key: k, fit: FIT, start, prevented, ...state(result.current) }),
      );
      unmount();
    }
  }

  // The wheel, at the pointer, in pixels, lines, and pages.
  for (const [deltaY, deltaMode, clientX, clientY] of [
    [-500, 0, 250, 160],
    [-100, 0, 410, 320],
    [120, 0, 410, 320],
    [-3, 1, 100, 500],
    [-1, 2, 700, 100],
    [2, 1, 50, 50],
    [-53.7, 0, 805, 615],
  ]) {
    const { result, svg, unmount } = mountHook(FIT, OFFSET_RECT);
    act(() => result.current.zoomIn());
    const start = state(result.current);
    act(() => {
      svg.dispatchEvent(
        new win.WheelEvent('wheel', { deltaY, deltaMode, clientX, clientY, cancelable: true }),
      );
    });
    cases.push(
      enc({
        fn: 'wheelFactor',
        deltaY,
        deltaMode,
        client: [clientX, clientY],
        rect: OFFSET_RECT,
        fit: FIT,
        start,
        ...state(result.current),
      }),
    );
    unmount();
  }

  // Zooming to a section: at once under reduced motion.
  reducedMotion = true;
  for (const [b, margin] of [
    [{ x: 100, y: 50, width: 40, height: 20 }, undefined],
    [{ x: 100, y: 50, width: 40, height: 20 }, 2],
    [{ x: 500, y: 300, width: 2, height: 1 }, undefined],
    [{ x: 10.5, y: 20.25, width: 300.1, height: 7 }, undefined],
    [{ x: 0, y: 0, width: 1000, height: 640 }, undefined],
    [{ x: 0, y: 0, width: 0, height: 0 }, undefined],
  ]) {
    const { result, unmount } = mountHook(FIT, OFFSET_RECT);
    act(() => result.current.zoomTo(b, margin));
    cases.push(enc({ fn: 'zoomToTarget', bounds: b, margin, fit: FIT, ...state(result.current) }));
    unmount();
  }
  reducedMotion = false;

  // The 200 ms animation, frame by frame on a clock the script moves.
  {
    const { result, unmount } = mountHook(FIT, OFFSET_RECT);
    act(() => result.current.zoomIn());
    const start = state(result.current);
    const b = { x: 100, y: 50, width: 40, height: 20 };
    now = 1000;
    frames = [];
    act(() => result.current.zoomTo(b));
    const steps = [];
    for (const t of [1000, 1016, 1050, 1100, 1133.3, 1150, 1199.9, 1200, 1250]) {
      const pending = frames;
      frames = [];
      if (pending.length === 0) break;
      now = t;
      act(() => pending.forEach((cb) => cb()));
      steps.push({ elapsed: t - 1000, more: frames.length > 0, ...state(result.current) });
    }
    cases.push(enc({ fn: 'animationFrame', bounds: b, fit: FIT, start, steps }));
    unmount();
    frames = [];
  }

  // A drag: no pan before 4 px, then the view follows the pointer; the click that ends it is
  // marked a drag. A press that moves less is a click.
  for (const path of [
    [
      [500, 300],
      [502, 301],
      [450, 280],
      [440, 260],
    ],
    [
      [500, 300],
      [501, 300],
    ],
    [
      [500, 300],
      [503.9, 300],
    ],
    [
      [500, 300],
      [500, 304],
      [520, 330],
    ],
    [
      [100, 100],
      [-5000, -5000],
    ],
  ]) {
    const { result, unmount } = mountHook(FIT, OFFSET_RECT);
    act(() => result.current.zoomIn());
    act(() => result.current.zoomIn());
    const start = state(result.current);
    act(() => result.current.onPointerDown(pointer(1, ...path[0])));
    const moves = [];
    for (const p of path.slice(1)) {
      act(() => result.current.onPointerMove(pointer(1, ...p)));
      moves.push({ to: p, ...state(result.current) });
    }
    const last = path[path.length - 1];
    act(() => result.current.onPointerUp(pointer(1, ...last)));
    cases.push(
      enc({
        fn: 'isDrag',
        rect: OFFSET_RECT,
        fit: FIT,
        start,
        path,
        moves,
        dragged: result.current.dragged(),
      }),
    );
    unmount();
  }

  // A pinch through the hook: each move of one finger, the other held.
  {
    const { result, unmount } = mountHook(FIT, OFFSET_RECT);
    const start = state(result.current);
    act(() => result.current.onPointerDown(pointer(1, 400, 300)));
    act(() => result.current.onPointerDown(pointer(2, 600, 300)));
    const moves = [];
    for (const [id, x, y] of [
      [1, 300, 300],
      [2, 700, 310],
      [1, 320, 280],
    ]) {
      act(() => result.current.onPointerMove(pointer(id, x, y)));
      moves.push({ id, to: [x, y], ...state(result.current) });
    }
    cases.push(
      enc({
        fn: 'pinchHook',
        rect: OFFSET_RECT,
        fit: FIT,
        start,
        down: [
          [1, [400, 300]],
          [2, [600, 300]],
        ],
        moves,
      }),
    );
    unmount();
  }

  // Fit map after zooming and panning: the fit, at once.
  {
    const { result, unmount } = mountHook(FIT, OFFSET_RECT);
    act(() => result.current.zoomIn());
    act(() => result.current.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }));
    act(() => result.current.fit());
    cases.push(enc({ fn: 'fit', fit: FIT, ...state(result.current) }));
    unmount();
  }
  cleanup();
  return cases;
}

// ------------------------------------------------------------------------------ the venue map

const SQUARE = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const MAPS = [
  {
    name: 'two sections and a floor',
    size: { width: 1000, height: 800 },
    floorKind: 'STAGE',
    floorOutline: SQUARE(400, 100, 200, 80),
    sections: [
      { name: '101', outline: SQUARE(300, 300, 120, 90), labelAt: [360, 345] },
      { name: '102', outline: SQUARE(450.5, 310.25, 140, 70), labelAt: [520.5, 345.25] },
    ],
  },
  {
    name: 'a floor of kind NONE is left out',
    size: { width: 600, height: 400 },
    floorKind: 'NONE',
    floorOutline: SQUARE(0, 0, 600, 400),
    sections: [{ name: 'A', outline: SQUARE(100, 100, 50, 30), labelAt: [125, 115] }],
  },
  {
    name: 'nothing drawn: the whole canvas',
    size: { width: 640, height: 480 },
    floorKind: 'NONE',
    floorOutline: null,
    sections: [],
  },
  {
    name: 'a tall frame',
    size: { width: 2000, height: 3000 },
    floorKind: 'RINK',
    floorOutline: SQUARE(900, 200, 200, 2400),
    sections: [
      { name: 'North', outline: SQUARE(700, 100, 100, 1000.3), labelAt: [750, 600] },
      { name: 'South', outline: SQUARE(1200, 1500, 100, 1300), labelAt: [1250, 2150] },
    ],
  },
  {
    name: 'a very wide frame',
    size: { width: 5000, height: 1000 },
    floorKind: 'COURT',
    floorOutline: null,
    sections: [
      { name: 'L', outline: SQUARE(10, 400, 100, 30), labelAt: [60, 415] },
      { name: 'R', outline: SQUARE(4500, 410, 120, 25), labelAt: [4560, 422.5] },
      {
        name: 'Curved',
        outline: geometry.outlineAround(
          seatsOf(values({ rows: 5, seatsPerRow: [30], curve: 50 }), [2500, 500], 12.5),
        ),
        labelAt: [2500, 495],
      },
    ],
  },
];

const mapData = (m, i) => ({
  eventId: `00000000-0000-4000-8000-00000000000${i}`,
  seq: 0,
  layoutId: `00000000-0000-4000-8000-00000000010${i}`,
  layoutName: m.name,
  size: m.size,
  floorKind: m.floorKind,
  floorOutline: m.floorOutline,
  levels: [],
  sections: m.sections.map((s, j) => ({
    sectionId: `00000000-0000-4000-8000-0000000002${i}${j}`,
    name: s.name,
    outline: s.outline,
    labelAt: s.labelAt,
    counts: [],
  })),
});

/**
 * `fitOf` is exported; the map's shape (`mapAspect`) and the names' size (`labelFontSize`) are
 * read off the rendered `VenueMap` at the fit and after each press of "Zoom in".
 */
function venueMapCases() {
  const cases = [];
  MAPS.forEach((m, i) => {
    const map = mapData(m, i);
    const fit = venueMap.fitOf(map);
    cases.push(enc({ fn: 'fitOf', map: m, out: fit }));
    const { container, getByRole, unmount } = render(
      React.createElement(venueMap.VenueMap, {
        map,
        colorBy: 'state',
        openSectionId: null,
        section: null,
        onOpenSection() {},
      }),
    );
    const svg = container.querySelector('svg.venue-map__svg');
    const zooms = [];
    for (let press = 0; press <= 10; press++) {
      if (press > 0) fireEvent.click(getByRole('button', { name: 'Zoom in' }));
      const label = container.querySelector('text.venue-map__label');
      zooms.push({
        presses: press,
        viewBox: svg.getAttribute('viewBox'),
        fontSize: label ? label.getAttribute('font-size') : null,
      });
    }
    cases.push(
      enc({
        fn: 'venueMap',
        map: m,
        fit,
        aspectRatio: svg.style.getPropertyValue('aspect-ratio') || null,
        zooms,
      }),
    );
    unmount();
  });
  return cases;
}

// ------------------------------------------------------------------------------ numbers, constants

/** `String(n)` for doubles of every kind, by their bits. */
function numberCases() {
  const fixed = [
    0,
    -0,
    1,
    -1,
    1.5,
    0.1,
    0.1 + 0.2,
    1 / 3,
    -2 / 3,
    100,
    123.456,
    1e21,
    1e20,
    123456789012345680000,
    999999999999999900000,
    1e-6,
    1e-7,
    0.000001234,
    0.0000001234,
    1.7976931348623157e308,
    5e-324,
    2.2250738585072014e-308,
    -1e-7,
    -1e21,
    2 ** 53,
    2 ** 53 + 2,
    4.35,
    0.5,
    -0.5,
    1e100,
    1.2e-100,
    NaN,
    Infinity,
    -Infinity,
    2 ** 53 + 1, // reads as 2 ** 53
    0.30000000000000004,
    12345.6789e-3,
  ];
  const rnd = seeded(37);
  const randoms = [];
  for (let i = 0; i < 400; i++) {
    const mantissa = (rnd() - 0.5) * 2;
    const exponent = Math.floor(rnd() * 60) - 30;
    randoms.push(mantissa * 10 ** exponent);
  }
  for (let i = 0; i < 200; i++) randoms.push(Math.round((rnd() - 0.5) * 1e6) / 1000);
  // Exactly halfway between two shortest candidates (…0.25 with an eighth the last bit, and the
  // like at other scales): JavaScript takes the even one.
  for (let i = 0; i < 100; i++) {
    const m = 2 ** 49 + Math.floor(rnd() * 2 ** 49);
    const scale = 2 ** (Math.floor(rnd() * 40) - 20);
    randoms.push((m + [0.25, 0.75, 0.375, 0.625][i % 4]) * scale);
  }
  for (let i = 0; i < 100; i++) {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint32(0, Math.floor(rnd() * 4294967296));
    view.setUint32(4, Math.floor(rnd() * 4294967296));
    const n = view.getFloat64(0);
    if (Number.isFinite(n)) randoms.push(n);
  }
  return [...fixed, ...randoms].map((n) => ({ bits: bitsOf(n), string: String(n) }));
}

function constants() {
  return enc({
    LAYOUT_LIMITS: seating.LAYOUT_LIMITS,
    LEVEL_COLORS: seating.LEVEL_COLORS,
    SEAT_GAP: geometry.SEAT_GAP,
    ROW_GAP: geometry.ROW_GAP,
    OUTLINE_MARGIN: geometry.OUTLINE_MARGIN,
    SIZE_MARGIN: geometry.SIZE_MARGIN,
    MAX_ZOOM: panZoom.MAX_ZOOM,
  });
}

// ------------------------------------------------------------------------------ write or check

const files = {
  'constants.json': constants(),
  'js-number.json': numberCases(),
  'layout-geometry.json': layoutGeometryCases(),
  'map-geometry.json': mapGeometryCases(),
  'pan-zoom.json': panZoomMathCases(),
  'pan-zoom-hook.json': panZoomHookCases(),
  'venue-map.json': venueMapCases(),
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
