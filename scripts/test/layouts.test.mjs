// Spec 038 (research R5, R18; FR-033; tasks T043): the KFC Yum! Center layout files made by
// scripts/layouts/generate-yum-center.mjs from the traced plan. Each is a valid `LayoutFile` of the
// contract, has the published totals (Basketball 22,090, End-stage concert 17,500) or our estimates
// (Center stage about 19,500, Wrestling about 18,000), the venue's row letters, the levels R18
// pins, and comes out byte for byte the same on every run, equal to the committed files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { LAYOUTS, renderAll } from '../layouts/generate-yum-center.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GENERATOR = join(ROOT, 'scripts', 'layouts', 'generate-yum-center.mjs');
const COMMITTED = join(ROOT, 'backend', 'src', 'scripts', 'layouts');

// The contract in Ajv 2020, as backend/test/contract/expect-to-match-contract.ts loads it (Ajv 8 is
// the Backend's dependency, so it is resolved from there).
const backendRequire = createRequire(join(ROOT, 'backend', 'package.json'));
const Ajv2020 = backendRequire('ajv/dist/2020').default;
const addFormats = backendRequire('ajv-formats').default;
const contract = parse(readFileSync(join(ROOT, 'contracts', 'openapi.yaml'), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract, 'openapi');
const validateLayoutFile = ajv.getSchema('openapi#/components/schemas/LayoutFile');

const FILES = [
  'yum-center-basketball.json',
  'yum-center-end-stage.json',
  'yum-center-center-stage.json',
  'yum-center-wrestling.json',
];
const rendered = await renderAll();
const byFile = new Map(rendered.map((r) => [r.file, JSON.parse(r.text)]));
const basketball = byFile.get('yum-center-basketball.json');
const endStage = byFile.get('yum-center-end-stage.json');
const centerStage = byFile.get('yum-center-center-stage.json');
const wrestling = byFile.get('yum-center-wrestling.json');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const LOWER_ROWS = [...LETTERS.slice(3), ...LETTERS.map((l) => l + l)]; // D…Z, AA, BB, …
const UPPER_ROWS = LETTERS.slice(0, LETTERS.indexOf('W') + 1); // A…W

const rowCount = (row) => (Array.isArray(row.seats) ? row.seats.length : row.seats.count);
const sectionSeats = (s) => s.rows.reduce((n, r) => n + rowCount(r), 0);
const seatTotal = (layout) => layout.sections.reduce((n, s) => n + sectionSeats(s), 0);
const section = (layout, name) => layout.sections.find((s) => s.name === name);
const names = (layout) => layout.sections.map((s) => s.name);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
const isLower = (name) => /^1\d\d$/.test(name);
const isTerrace = (name) => /^2\d\d$/.test(name);
const isUpper = (name) => /^3\d\d$/.test(name);
const within = (value, target, pct) => Math.abs(value - target) <= (target * pct) / 100;

/** Each seat of a row, as the Backend expands a run (R5, T004): a quadratic through `bend`. */
function seatsOf(row) {
  if (Array.isArray(row.seats)) return row.seats.map((s) => ({ label: s.label, at: s.at }));
  const { first, count, from, to, bend } = row.seats;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    let at;
    if (!bend) at = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    else {
      const c = [0, 1].map((k) => 2 * bend[k] - (from[k] + to[k]) / 2);
      at = [0, 1].map((k) => (1 - t) ** 2 * from[k] + 2 * (1 - t) * t * c[k] + t ** 2 * to[k]);
    }
    return { label: String(first + i), at };
  });
}

function inside([x, y], outline) {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

test('the generator makes the four layouts, named as R18 names them', () => {
  assert.deepEqual(
    rendered.map((r) => r.file),
    FILES,
  );
  assert.deepEqual(
    LAYOUTS.map((l) => l.name),
    ['Basketball', 'End-stage concert', 'Center stage', 'Wrestling (ring)'],
  );
  assert.deepEqual(
    [basketball, endStage, centerStage, wrestling].map((l) => [l.name, l.floor.kind]),
    [
      ['Basketball', 'COURT'],
      ['End-stage concert', 'END_STAGE'],
      ['Center stage', 'CENTER_STAGE'],
      ['Wrestling (ring)', 'RING'],
    ],
  );
});

for (const file of FILES) {
  test(`${file} is a valid LayoutFile of the contract and within R5's limits`, () => {
    const layout = byFile.get(file);
    const valid = validateLayoutFile(layout);
    assert.ok(valid, JSON.stringify(validateLayoutFile.errors?.slice(0, 5), null, 2));

    const { width, height } = layout.size;
    const inSize = ([x, y]) => x >= 0 && y >= 0 && x <= width && y <= height;
    assert.ok(layout.floor.outline.every(inSize), 'floor outline inside size');

    const keys = new Set(layout.levels.map((l) => l.key));
    assert.equal(keys.size, layout.levels.length, 'level keys unique');
    assert.equal(new Set(layout.levels.map((l) => l.rank)).size, layout.levels.length, 'ranks');
    assert.equal(
      new Set(layout.levels.map((l) => l.name.toLowerCase())).size,
      layout.levels.length,
      'level names unique',
    );
    assert.equal(
      new Set(layout.sections.map((s) => s.name.toLowerCase())).size,
      layout.sections.length,
      'section names unique',
    );
    assert.ok(seatTotal(layout) <= 30000);

    for (const s of layout.sections) {
      assert.ok(keys.has(s.level), `${s.name}: level ${s.level}`);
      assert.ok(s.outline.every(inSize), `${s.name}: outline inside size`);
      const rowLabels = s.rows.map((r) => r.label);
      assert.equal(new Set(rowLabels).size, rowLabels.length, `${s.name}: row labels unique`);
      for (const row of s.rows) {
        if (row.level) assert.ok(keys.has(row.level), `${s.name} ${row.label}: level`);
        const seats = seatsOf(row);
        assert.equal(new Set(seats.map((x) => x.label)).size, seats.length);
        for (const seat of seats) {
          assert.ok(seat.label.length <= 5);
          assert.ok(inSize(seat.at), `${s.name} ${row.label} ${seat.label}: inside size`);
          assert.ok(
            inside(seat.at, s.outline),
            `${s.name} ${row.label} ${seat.label} at ${seat.at}: inside its section`,
          );
        }
      }
    }
  });
}

test('Basketball: 54 sections (101–120, terrace 209–212, 301–330) and exactly 22,090 seats', () => {
  assert.deepEqual(names(basketball), [...range(101, 120), ...range(209, 212), ...range(301, 330)]);
  assert.equal(seatTotal(basketball), 22090);
});

test('End-stage concert: exactly 17,500 seats, the published cut, 104 and 118 partial, floor 1–5', () => {
  assert.equal(seatTotal(endStage), 17500);
  const cut = [...range(101, 103), ...range(119, 120), ...range(301, 306), ...range(325, 330)];
  for (const name of cut) assert.equal(section(endStage, name), undefined, `${name} removed`);
  for (const name of ['104', '118']) {
    assert.ok(section(endStage, name), `${name} kept`);
    assert.ok(sectionSeats(section(endStage, name)) < sectionSeats(section(basketball, name)));
  }
  const floor = endStage.sections.filter((s) => !isLower(s.name) && !isUpper(s.name));
  assert.deepEqual(
    floor.filter((s) => !isTerrace(s.name)).map((s) => s.name),
    ['Floor 1', 'Floor 2', 'Floor 3', 'Floor 4', 'Floor 5'],
  );
});

test('Center stage and Wrestling are within 5% of our estimates, with floor sections', () => {
  assert.ok(within(seatTotal(centerStage), 19500, 5), `center stage ${seatTotal(centerStage)}`);
  assert.ok(within(seatTotal(wrestling), 18000, 5), `wrestling ${seatTotal(wrestling)}`);
  for (const layout of [centerStage, wrestling]) {
    assert.ok(
      layout.sections.some((s) => s.name.startsWith('Floor ')),
      layout.name,
    );
  }
  // The demo's wrestling event puts rows S–W of 305–310 and 320–325 off sale (R18).
  for (const name of [...range(305, 310), ...range(320, 325)]) {
    const rows = section(wrestling, name)?.rows.map((r) => r.label) ?? [];
    for (const label of ['S', 'T', 'U', 'V', 'W']) assert.ok(rows.includes(label), name + label);
  }
});

test('row letters: lower sections D…Z then AA…, upper sections A…W', () => {
  for (const layout of [basketball, endStage, centerStage, wrestling]) {
    for (const s of layout.sections) {
      const labels = s.rows.map((r) => r.label);
      if (isLower(s.name)) {
        assert.ok(labels.length >= 23, `${layout.name} ${s.name}: D–Z at least`);
        assert.deepEqual(labels, LOWER_ROWS.slice(0, labels.length), `${layout.name} ${s.name}`);
      }
      if (isUpper(s.name)) assert.deepEqual(labels, UPPER_ROWS, `${layout.name} ${s.name}`);
    }
  }
  assert.ok(
    basketball.sections.some((s) => s.rows.some((r) => r.label === 'AA')),
    'some lower sections go deeper than Z',
  );
});

test('seat 1 is on the right facing the court or the stage', () => {
  // y grows downward: 106 is the north sideline (facing south, its right is west), 115 the south.
  const firstAndLast = (layout, name) => {
    const { from, to } = section(layout, name).rows[0].seats;
    return { from, to };
  };
  const north = firstAndLast(basketball, '106');
  assert.ok(north.from[0] < north.to[0], '106: seat 1 at the west end');
  const south = firstAndLast(basketball, '115');
  assert.ok(south.from[0] > south.to[0], '115: seat 1 at the east end');
  // End-stage floor sections face the stage in the west; their right is north.
  const floor = firstAndLast(endStage, 'Floor 2');
  assert.ok(floor.from[1] < floor.to[1], 'Floor 2: seat 1 at the north end');
});

test("Basketball's four levels are exactly as R18 pins them", () => {
  assert.deepEqual(basketball.levels, [
    { key: 'courtside', name: 'Courtside', rank: 1, color: 'violet' },
    { key: 'lower-sideline', name: 'Lower sideline', rank: 2, color: 'blue' },
    { key: 'lower-end', name: 'Lower end', rank: 3, color: 'teal' },
    { key: 'upper', name: 'Upper', rank: 4, color: 'green' },
  ]);
  const sideline = [...range(104, 108), ...range(113, 117)];
  const ends = [...range(101, 103), ...range(109, 112), ...range(118, 120)];
  const expected = (sectionName, rowLabel) => {
    if (sideline.includes(sectionName))
      return ['D', 'E', 'F', 'G'].includes(rowLabel) ? 'courtside' : 'lower-sideline';
    if (isTerrace(sectionName)) return 'lower-sideline';
    if (ends.includes(sectionName)) return 'lower-end';
    if (isUpper(sectionName)) return 'upper';
    return 'none';
  };
  for (const s of basketball.sections) {
    for (const row of s.rows) {
      const seats = Array.isArray(row.seats) ? row.seats : [{}];
      for (const seat of seats) {
        const level = seat.level ?? row.level ?? s.level;
        assert.equal(level, expected(s.name, row.label), `${s.name} ${row.label}`);
      }
    }
  }
});

test('the other layouts have three levels: Floor (1), Lower (2), Upper (3)', () => {
  for (const layout of [endStage, centerStage, wrestling]) {
    assert.deepEqual(
      layout.levels.map((l) => [l.key, l.name, l.rank]),
      [
        ['floor', 'Floor', 1],
        ['lower', 'Lower', 2],
        ['upper', 'Upper', 3],
      ],
      layout.name,
    );
    for (const s of layout.sections) {
      const want = isUpper(s.name)
        ? 'upper'
        : isLower(s.name) || isTerrace(s.name)
          ? 'lower'
          : 'floor';
      assert.equal(s.level, want, `${layout.name} ${s.name}`);
      for (const row of s.rows) assert.equal(row.level ?? want, want, `${s.name} ${row.label}`);
    }
  }
});

function run(args) {
  return spawnSync(process.execPath, [GENERATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('running it twice gives byte-identical files', () => {
  const a = mkdtempSync(join(tmpdir(), 'qp-layouts-a-'));
  const b = mkdtempSync(join(tmpdir(), 'qp-layouts-b-'));
  try {
    assert.equal(run(['--out', a]).status, 0);
    assert.equal(run(['--out', b]).status, 0);
    assert.deepEqual(readdirSync(a).sort(), [...FILES].sort());
    for (const file of FILES) {
      assert.ok(readFileSync(join(a, file)).equals(readFileSync(join(b, file))), file);
    }
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('the committed files equal a fresh run; --check fails when one differs', () => {
  for (const r of rendered) {
    assert.equal(readFileSync(join(COMMITTED, r.file), 'utf8'), r.text, `${r.file} is current`);
  }
  const ok = run(['--check']);
  assert.equal(ok.status, 0, ok.stderr);

  const dir = mkdtempSync(join(tmpdir(), 'qp-layouts-check-'));
  try {
    assert.equal(run(['--out', dir]).status, 0);
    const changed = join(dir, 'yum-center-wrestling.json');
    writeFileSync(changed, readFileSync(changed, 'utf8').replace('"Wrestling (ring)"', '"Ring"'));
    const stale = run(['--check', '--out', dir]);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /yum-center-wrestling\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
