// Spec 038 (research R5, R18; FR-033): makes the KFC Yum! Center's four layout files from the
// section plan in scripts/layouts/yum-center/plan.json. Usage, from the repository root:
//
//   node scripts/layouts/generate-yum-center.mjs            # writes backend/src/scripts/layouts/
//   node scripts/layouts/generate-yum-center.mjs --check    # exits 1 when a committed file differs
//   node scripts/layouts/generate-yum-center.mjs --out DIR  # writes (or with --check, compares) DIR
//
// The bowl is one shape for every layout: a rounded rectangle (a superellipse) around the floor,
// and rings of rows (lower, terrace, upper) at depths along its outward normal, so each section is
// bounded by two normal lines and every row is a smooth arc written as one seat run with a `bend`
// at its middle (R5). Seats per row follow each row's length, scaled so the whole bowl holds the
// plan's `bowl.seats` (Basketball's published 22,090). Each other layout removes what its plan
// removes and fills its floor sections with what is left to reach its own total. Each file is
// checked against the contract's `LayoutFile` schema and R5's other limits (every seat inside its
// own section and no other, none on the floor object), then written one row a line with places
// rounded to 0.1, so the output is the same on every run. Prettier skips the files
// (.prettierignore), as it skips the other generated file, packages/shared/src/api-schema.ts.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PLAN_PATH = join(ROOT, 'scripts', 'layouts', 'yum-center', 'plan.json');
export const OUT_DIR = join(ROOT, 'backend', 'src', 'scripts', 'layouts');

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
export const LAYOUTS = plan.layouts.map(({ file, name }) => ({ file, name }));

const round = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};
const pt = ([x, y]) => [round(x), round(y)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];

/** "104-108" or "104" → the names it covers. */
function expandNames(spec) {
  const m = /^(\d+)-(\d+)$/.exec(spec);
  if (!m) return [spec];
  const out = [];
  for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(String(n));
  return out;
}
const nameSet = (specs = []) => new Set(specs.flatMap(expandNames));

/** "D-Z,AA-HH" → D, E, …, Z, AA, BB, …, HH: single letters, or a letter doubled. */
function rowLabels(spec) {
  return spec.split(',').flatMap((part) => {
    const [a, b] = part.trim().split('-');
    const times = a.length;
    if (!/^([A-Z])\1*$/.test(a) || !b || b.length !== times || b[0] < a[0]) {
      throw new Error(`row labels "${spec}": write ranges such as D-Z or AA-HH`);
    }
    const out = [];
    for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) {
      out.push(String.fromCharCode(c).repeat(times));
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// The bowl's shape: the front edge of the lower ring, sampled, with its outward normals. A place
// is (s, d): `s` a fractional sample index along the edge (clockwise on the map, from the east end's
// middle), `d` the depth in map units along the normal. Arc length at depth d is L0(s) + d·φ(s).

function makeBowl({ halfLength: A, halfWidth: B, exponent: p, samples: N }) {
  const P = [];
  const Nn = [];
  for (let i = 0; i < N; i++) {
    const u = (2 * Math.PI * i) / N;
    const c = Math.cos(u);
    const s = Math.sin(u);
    const x = A * Math.sign(c) * Math.abs(c) ** (2 / p);
    const y = B * Math.sign(s) * Math.abs(s) ** (2 / p);
    const gx = (Math.sign(x) * Math.abs(x / A) ** (p - 1)) / A;
    const gy = (Math.sign(y) * Math.abs(y / B) ** (p - 1)) / B;
    const g = Math.hypot(gx, gy);
    P.push([x, y]);
    Nn.push([gx / g, gy / g]);
  }
  const L0 = [0];
  const phi = [0];
  for (let i = 1; i <= N; i++) {
    const a = P[i - 1];
    const b = P[i % N];
    L0.push(L0[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    let d = Math.atan2(Nn[i % N][1], Nn[i % N][0]) - Math.atan2(Nn[i - 1][1], Nn[i - 1][0]);
    while (d < 0) d += 2 * Math.PI;
    phi.push(phi[i - 1] + d);
  }

  const lerp = (arr, s) => {
    const i = Math.floor(s);
    const f = s - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  };
  /** Arc length from s = 0 to s at depth d (s may run past N, once round). */
  const arcAt = (s, d) => {
    const turns = Math.floor(s / N);
    const r = s - turns * N;
    return turns * (L0[N] + 2 * Math.PI * d) + lerp(L0, r) + d * lerp(phi, r);
  };
  const total = (d) => L0[N] + 2 * Math.PI * d;
  /** The s at arc length `a` along depth d. */
  const sAt = (a, d) => {
    const T = total(d);
    const turns = Math.floor(a / T);
    const r = a - turns * T;
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L0[mid] + d * phi[mid] <= r) lo = mid;
      else hi = mid;
    }
    const a0 = L0[lo] + d * phi[lo];
    const a1 = L0[hi] + d * phi[hi];
    return turns * N + lo + (a1 > a0 ? (r - a0) / (a1 - a0) : 0);
  };
  const pointAt = (s, d) => {
    const r = ((s % N) + N) % N;
    const i = Math.floor(r);
    const f = r - i;
    const j = (i + 1) % N;
    const base = [P[i][0] + (P[j][0] - P[i][0]) * f, P[i][1] + (P[j][1] - P[i][1]) * f];
    let n = [Nn[i][0] + (Nn[j][0] - Nn[i][0]) * f, Nn[i][1] + (Nn[j][1] - Nn[i][1]) * f];
    n = scale(n, 1 / Math.hypot(n[0], n[1]));
    return add(base, scale(n, d));
  };
  /** The s at a position in "bowl degrees" (arc length share, 0–360) along depth d. */
  const sAtDegrees = (deg, d) => sAt((deg / 360) * total(d), d);
  /** Inside the front edge (the floor), with `margin` map units to spare. */
  const onFloor = ([x, y], margin = 0) =>
    Math.abs(x / (A - margin)) ** p + Math.abs(y / (B - margin)) ** p < 1;
  return { N, arcAt, sAt, pointAt, sAtDegrees, onFloor };
}

// ---------------------------------------------------------------------------------------------
// Bowl sections: geometry and the length of each row, before any seats are counted.

function bowlSections(bowl) {
  const out = [];
  for (const ring of plan.rings) {
    const labels = rowLabels(ring.rowLabels);
    for (const sec of ring.sections) {
      const rows = sec.rows ?? ring.rows;
      if (rows > labels.length) throw new Error(`${sec.name}: more rows than labels`);
      const s0 = bowl.sAtDegrees(sec.from, ring.refDepth);
      let s1 = bowl.sAtDegrees(sec.to === 360 ? 360 - 1e-9 : sec.to, ring.refDepth);
      if (s1 <= s0) s1 += bowl.N;
      const rowList = [];
      for (let k = 0; k < rows; k++) {
        const d = ring.frontDepth + ring.rowPitch * (k + 0.5);
        const a0 = bowl.arcAt(s0, d) + ring.aisle / 2;
        const a1 = bowl.arcAt(s1, d) - ring.aisle / 2;
        const len = a1 - a0;
        rowList.push({
          label: labels[k],
          d,
          a0,
          a1,
          raw: len / ring.seatPitch,
          lo: Math.ceil(len / plan.limits.maxSeatPitch),
          hi: Math.min(200, Math.floor(len / plan.limits.minSeatPitch)),
        });
      }
      out.push({ name: sec.name, ring, s0, s1, rows: rowList });
    }
  }
  return out;
}

/**
 * Whole numbers in proportion to each item's `raw`, each within its own `lo`–`hi` when given,
 * summing to `target`: the largest k with Σ clamp(⌊raw·k⌋) ≤ target, then one more each to the
 * largest remainders (ties to the earlier item), so the same plan always gives the same counts.
 */
function apportion(items, target) {
  const lo = (it) => it.lo ?? 0;
  const hi = (it) => it.hi ?? Infinity;
  const at = (k) => items.map((it) => Math.min(hi(it), Math.max(lo(it), Math.floor(it.raw * k))));
  const sum = (arr) => arr.reduce((n, v) => n + v, 0);
  if (sum(items.map(lo)) > target || sum(items.map(hi)) < target) {
    throw new Error(`cannot place ${target} seats within the seat spacing limits`);
  }
  let kLo = 0;
  let kHi = 1;
  while (sum(at(kHi)) <= target) kHi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (kLo + kHi) / 2;
    if (sum(at(mid)) <= target) kLo = mid;
    else kHi = mid;
  }
  const base = at(kLo);
  let left = target - sum(base);
  const order = items
    .map((it, i) => ({ i, frac: it.raw * kLo - Math.floor(it.raw * kLo) }))
    .filter(({ i }) => base[i] < hi(items[i]))
    .sort((x, y) => y.frac - x.frac || x.i - y.i);
  for (let j = 0; left > 0; j++, left--) base[order[j].i] += 1;
  return base;
}

/** A run of `count` seats evenly along depth d from arc a0 to a1 (seat centers), R5. */
function arcRun(bowl, d, a0, a1, first, count) {
  const from = pt(bowl.pointAt(bowl.sAt(a0, d), d));
  const to = pt(bowl.pointAt(bowl.sAt(a1, d), d));
  if (count === 1) return { first, count, from, to: from };
  const bend = pt(bowl.pointAt(bowl.sAt((a0 + a1) / 2, d), d));
  return { first, count, from, to, bend };
}

function arcOutline(bowl, sec, sFrom, sTo, gap) {
  const { ring } = sec;
  const front = ring.frontDepth;
  const back = ring.frontDepth + ring.rowPitch * sec.rows.length;
  const edge = (d) => {
    const a0 = bowl.arcAt(sFrom, d) + gap / 2;
    const a1 = bowl.arcAt(sTo, d) - gap / 2;
    const steps = Math.min(24, Math.max(2, Math.ceil((a1 - a0) / 6)));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / steps;
      return bowl.pointAt(bowl.sAt(a, d), d);
    });
  };
  return [...edge(front), ...edge(back).reverse()];
}

// ---------------------------------------------------------------------------------------------
// Floor sections: rectangles of straight rows facing the stage; seat 1 on the right (R18).

const FACING = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

function floorSection(fs, counts, floorPlan) {
  const f = FACING[fs.facing];
  if (!f) throw new Error(`${fs.name}: facing must be N, S, E or W`);
  const right = [-f[1], f[0]];
  const depth = fs.rows * floorPlan.rowPitch;
  const c = fs.center;
  const halfW = fs.width / 2;
  const corner = (along, toward) => add(add(c, scale(right, along)), scale(f, toward));
  const outline = [
    corner(halfW, depth / 2),
    corner(-halfW, depth / 2),
    corner(-halfW, -depth / 2),
    corner(halfW, -depth / 2),
  ];
  const usable = fs.width - 2 * floorPlan.edge;
  const rows = counts.map((count, k) => {
    const pitch = usable / count;
    if (pitch < floorPlan.minSeatPitch || pitch > floorPlan.maxSeatPitch) {
      throw new Error(`${fs.name} row ${k + 1}: ${count} seats are ${pitch.toFixed(2)} apart`);
    }
    const toward = depth / 2 - floorPlan.rowPitch * (k + 0.5);
    const half = usable / 2 - pitch / 2;
    return {
      label: String(k + 1),
      seats:
        count === 1
          ? { first: 1, count, from: pt(corner(0, toward)), to: pt(corner(0, toward)) }
          : { first: 1, count, from: pt(corner(half, toward)), to: pt(corner(-half, toward)) },
    };
  });
  return { outline, rows };
}

// ---------------------------------------------------------------------------------------------

function levelRules(layout) {
  return layout.bowlLevels.map((r) => ({
    level: r.level,
    names: nameSet(r.sections),
    rows: r.rows ? new Set(r.rows) : null,
  }));
}
function sectionLevel(rules, name) {
  const rule = rules.find((r) => !r.rows && r.names.has(name));
  if (!rule) throw new Error(`no level for section ${name}`);
  return rule.level;
}
function rowLevel(rules, name, label, fallback) {
  const rule = rules.find((r) => r.rows && r.names.has(name) && r.rows.has(label));
  return rule ? rule.level : fallback;
}

function buildLayouts() {
  const bowl = makeBowl(plan.bowl);
  const center = plan.center;
  const abs = (p) => pt(add(center, p));
  const sections = bowlSections(bowl);
  const allRows = sections.flatMap((s) => s.rows);
  const counts = apportion(allRows, plan.bowl.seats);
  allRows.forEach((r, i) => (r.count = counts[i]));
  for (const r of allRows) {
    const pitch = (r.a1 - r.a0) / r.count;
    if (pitch < plan.limits.minSeatPitch || pitch > plan.limits.maxSeatPitch) {
      throw new Error(`bowl row ${r.label}: ${r.count} seats are ${pitch.toFixed(2)} apart`);
    }
  }

  return plan.layouts.map((layout) => {
    const rules = levelRules(layout);
    const removed = nameSet(layout.remove);
    const partial = new Map((layout.partial ?? []).map((p) => [p.section, p]));
    const out = [];
    let bowlSeats = 0;
    for (const sec of sections) {
      if (removed.has(sec.name)) continue;
      const level = sectionLevel(rules, sec.name);
      const cut = partial.get(sec.name);
      let sFrom = sec.s0;
      let sTo = sec.s1;
      if (cut) {
        const ref = sec.ring.refDepth;
        const start = bowl.arcAt(sec.s0, ref);
        const aRef = start + cut.at * (bowl.arcAt(sec.s1, ref) - start);
        const sCut = bowl.sAt(aRef, ref);
        const sCutU = sCut < sec.s0 ? sCut + bowl.N : sCut;
        if (cut.keep === 'after') sFrom = sCutU;
        else if (cut.keep === 'before') sTo = sCutU;
        else throw new Error(`${sec.name}: partial keep must be "after" or "before"`);
      }
      const rows = [];
      for (const r of sec.rows) {
        const pitch = (r.a1 - r.a0) / r.count;
        let first = 1;
        let last = r.count;
        if (cut) {
          // Keep the seats whose centers lie inside the kept part, clear of the aisle.
          const lo = bowl.arcAt(sFrom, r.d) + sec.ring.aisle / 2;
          const hi = bowl.arcAt(sTo, r.d) - sec.ring.aisle / 2;
          const at = (i) => r.a0 + pitch * (i - 0.5);
          while (first <= last && at(first) < lo + pitch / 2) first++;
          while (last >= first && at(last) > hi - pitch / 2) last--;
          if (last < first) continue;
        }
        const count = last - first + 1;
        const a0 = r.a0 + pitch * (first - 0.5);
        const a1 = r.a0 + pitch * (last - 0.5);
        const run = arcRun(bowl, r.d, a0, a1, first, count);
        const row = { label: r.label };
        const lvl = rowLevel(rules, sec.name, r.label, level);
        if (lvl !== level) row.level = lvl;
        row.seats = {
          ...run,
          from: abs(run.from),
          to: abs(run.to),
          ...(run.bend ? { bend: abs(run.bend) } : {}),
        };
        rows.push(row);
        bowlSeats += count;
      }
      const outline = arcOutline(bowl, sec, sFrom, sTo, plan.limits.sectionGap).map(abs);
      out.push({ name: sec.name, level, outline, rows });
    }

    const floorSeats = layout.seats - bowlSeats;
    const fsList = layout.floorSections ?? [];
    if (fsList.length === 0 && floorSeats !== 0) {
      throw new Error(`${layout.name}: the bowl holds ${bowlSeats}, not ${layout.seats}`);
    }
    if (fsList.length > 0) {
      const fp = plan.floorSeating;
      const perSection = apportion(
        fsList.map((fs) => {
          const usable = fs.width - 2 * fp.edge;
          return {
            raw: fs.rows * usable,
            lo: fs.rows * Math.ceil(usable / fp.maxSeatPitch),
            hi: fs.rows * Math.min(200, Math.floor(usable / fp.minSeatPitch)),
          };
        }),
        floorSeats,
      );
      fsList.forEach((fs, i) => {
        const n = perSection[i];
        const rowCounts = Array.from(
          { length: fs.rows },
          (_, k) => Math.floor(n / fs.rows) + (k < n % fs.rows ? 1 : 0),
        );
        const built = floorSection(fs, rowCounts, fp);
        for (const p of built.outline) {
          if (!bowl.onFloor(p, 1)) throw new Error(`${fs.name}: corner ${p} is off the floor`);
        }
        out.push({
          name: fs.name,
          level: fs.level,
          outline: built.outline.map(abs),
          rows: built.rows.map((row) => ({
            ...row,
            seats: { ...row.seats, from: abs(row.seats.from), to: abs(row.seats.to) },
          })),
        });
      });
    }

    return {
      file: layout.file,
      summary: `${layout.name}: ${layout.seats} seats (bowl ${bowlSeats}, floor ${floorSeats})`,
      layout: {
        format: 1,
        name: layout.name,
        floor: { kind: layout.floor.kind, outline: layout.floor.outline.map(abs) },
        size: plan.size,
        levels: layout.levels,
        sections: out,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Checks: the contract's LayoutFile schema (Ajv 2020, as backend/test/contract loads it) and the
// limits a schema cannot state (R5, FR-001–FR-003).

function loadSchemaCheck() {
  const backendRequire = createRequire(join(ROOT, 'backend', 'package.json'));
  const Ajv2020 = backendRequire('ajv/dist/2020').default;
  const addFormats = backendRequire('ajv-formats').default;
  const contract = parse(readFileSync(join(ROOT, 'contracts', 'openapi.yaml'), 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(contract, 'openapi');
  return ajv.getSchema('openapi#/components/schemas/LayoutFile');
}

/** Each seat of a run, as the Backend expands it (R5, T004): evenly, on a quadratic through `bend`. */
export function seatsOfRun({ first, count, from, to, bend }) {
  const c = bend ? [0, 1].map((k) => 2 * bend[k] - (from[k] + to[k]) / 2) : null;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    const at = [0, 1].map((k) =>
      c
        ? (1 - t) ** 2 * from[k] + 2 * (1 - t) * t * c[k] + t ** 2 * to[k]
        : from[k] + (to[k] - from[k]) * t,
    );
    return { label: String(first + i), at };
  });
}

function insidePolygon([x, y], outline) {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function check(file, layout, validate) {
  const problems = [];
  if (!validate(layout)) {
    for (const e of validate.errors.slice(0, 10)) problems.push(`${e.instancePath} ${e.message}`);
  }
  const { width, height } = layout.size;
  const inSize = ([x, y]) => x >= 0 && y >= 0 && x <= width && y <= height;
  const keys = new Set(layout.levels.map((l) => l.key));
  if (new Set(layout.levels.map((l) => l.rank)).size !== layout.levels.length) {
    problems.push('level ranks repeat');
  }
  const floor = layout.floor.outline;
  if (floor && !floor.every(inSize)) problems.push('the floor object is outside the map');
  const sectionNames = new Set();
  let seats = 0;
  for (const s of layout.sections) {
    if (sectionNames.has(s.name.toLowerCase())) problems.push(`section ${s.name} repeats`);
    sectionNames.add(s.name.toLowerCase());
    if (!keys.has(s.level)) problems.push(`section ${s.name}: no level ${s.level}`);
    if (!s.outline.every(inSize)) problems.push(`section ${s.name}: outline outside the map`);
    const others = layout.sections.filter((o) => o !== s);
    const rowLabels = new Set();
    for (const r of s.rows) {
      if (rowLabels.has(r.label)) problems.push(`section ${s.name}: row ${r.label} repeats`);
      rowLabels.add(r.label);
      if (r.level && !keys.has(r.level)) problems.push(`${s.name} ${r.label}: no level`);
      if (r.seats.first + r.seats.count - 1 > 99999) problems.push(`${s.name} ${r.label}: labels`);
      seats += r.seats.count;
      for (const seat of seatsOfRun(r.seats)) {
        const where = `section ${s.name}, row ${r.label}, seat ${seat.label}`;
        if (!inSize(seat.at)) problems.push(`${where} is outside the map`);
        if (!insidePolygon(seat.at, s.outline)) problems.push(`${where} is outside its section`);
        if (floor && insidePolygon(seat.at, floor))
          problems.push(`${where} is on the floor object`);
        const hit = others.find((o) => insidePolygon(seat.at, o.outline));
        if (hit) problems.push(`${where} is inside section ${hit.name}`);
      }
    }
  }
  if (seats > 30000) problems.push(`${seats} seats`);
  if (problems.length > 0) {
    const more = problems.length > 20 ? `\n  … and ${problems.length - 20} more` : '';
    throw new Error(
      `${file} is not a valid layout:\n  ${problems.slice(0, 20).join('\n  ')}${more}`,
    );
  }
}

/** One value on one line, spaced as Prettier spaces JSON. */
const inline = (v) => {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') {
    const body = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return `{ ${body.join(', ')} }`;
  }
  return JSON.stringify(v);
};

/** The file's text: one level, outline or row a line, so a reviewer can read a diff. */
export function serialize(layout) {
  const { sections, levels, ...head } = layout;
  const lines = ['{'];
  for (const [k, v] of Object.entries(head)) lines.push(`  ${JSON.stringify(k)}: ${inline(v)},`);
  lines.push('  "levels": [');
  levels.forEach((l, i) => lines.push(`    ${inline(l)}${i < levels.length - 1 ? ',' : ''}`));
  lines.push('  ],');
  lines.push('  "sections": [');
  sections.forEach((s, i) => {
    const { rows, ...rest } = s;
    lines.push('    {');
    for (const [k, v] of Object.entries(rest))
      lines.push(`      ${JSON.stringify(k)}: ${inline(v)},`);
    lines.push('      "rows": [');
    rows.forEach((r, j) => lines.push(`        ${inline(r)}${j < rows.length - 1 ? ',' : ''}`));
    lines.push('      ]');
    lines.push(`    }${i < sections.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** Every layout file as the text the generator writes, each checked first. */
export async function renderAll() {
  const validate = loadSchemaCheck();
  return buildLayouts().map(({ file, summary, layout }) => {
    check(file, layout, validate);
    const text = serialize(layout);
    if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(layout)) {
      throw new Error(`${file}: the written text does not read back as the layout`);
    }
    return { file, summary, text };
  });
}

async function main(argv) {
  const checkOnly = argv.includes('--check');
  const outAt = argv.indexOf('--out');
  const dir = outAt >= 0 ? argv[outAt + 1] : OUT_DIR;
  if (!dir) throw new Error('--out needs a directory');
  const files = await renderAll();
  if (checkOnly) {
    const stale = files.filter(
      ({ file, text }) =>
        !existsSync(join(dir, file)) || readFileSync(join(dir, file), 'utf8') !== text,
    );
    for (const { file } of stale) {
      console.error(`${join(dir, file)} differs from a fresh run: run ${CMD}`);
    }
    if (stale.length > 0) return 1;
    console.log(`[layouts] ${files.length} Yum! Center layout files are current`);
    return 0;
  }
  mkdirSync(dir, { recursive: true });
  for (const { file, summary, text } of files) {
    writeFileSync(join(dir, file), text);
    console.log(`[layouts] ${file}: ${summary}`);
  }
  return 0;
}

const CMD = 'node scripts/layouts/generate-yum-center.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(2);
    },
  );
}
