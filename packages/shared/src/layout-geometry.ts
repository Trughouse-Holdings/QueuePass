import type { components } from './api-schema.js';
import { LAYOUT_LIMITS } from './seating.js';

/**
 * Spec 039 research R5, R6, R7 (T009, T030): the layout editor's geometry, pure, in map units with
 * `y` growing downward (as the venue map draws). The Backend draws every saved outline with
 * `outlineAround` and the editor draws the same one live (FR-008, FR-025); the block generator
 * makes a section's rows and seats (FR-006, FR-007).
 */

/** A place `[x, y]`. */
export type Pt = readonly [number, number];

/** Seats are this far apart along a row, and rows this far apart (038's standard spacing). */
export const SEAT_GAP = 2;
export const ROW_GAP = 2;
/** How far an outline stands out from the seats it is drawn around: half a gap plus a seat. */
export const OUTLINE_MARGIN = 1.5;
/** How much room the map leaves past the furthest thing drawn on it. */
export const SIZE_MARGIN = 10;

/**
 * How far a point on the front or back edge may be left out of the outline: the edge then passes
 * at most this much nearer the seats, which stay at least 1 unit inside it.
 */
const EDGE_TOLERANCE = 0.5;

const sub = (a: Pt, b: Pt): [number, number] => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): [number, number] => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Pt, k: number): [number, number] => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
const length = (a: Pt): number => Math.hypot(a[0], a[1]);
const unit = (a: Pt): [number, number] => {
  const l = length(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
};
/** `a` turned a quarter, so it is at right angles to it. */
const perp = (a: Pt): [number, number] => [-a[1], a[0]];
const mean = (points: readonly Pt[]): [number, number] => [
  points.reduce((s, p) => s + p[0], 0) / points.length,
  points.reduce((s, p) => s + p[1], 0) / points.length,
];

/** Every point moved by `(dx, dy)`. */
export function moveBy(points: readonly Pt[], dx: number, dy: number): [number, number][] {
  return points.map((p) => [p[0] + dx, p[1] + dy]);
}

/** Every point turned `degrees` clockwise (with `y` down) about `origin`. */
export function turnAbout(points: readonly Pt[], origin: Pt, degrees: number): [number, number][] {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return points.map((p) => {
    const x = p[0] - origin[0];
    const y = p[1] - origin[1];
    return [origin[0] + x * cos - y * sin, origin[1] + x * sin + y * cos];
  });
}

/** An angle in degrees as one in `(-180, 180]`. */
export function normalizeAngle(degrees: number): number {
  const a = (((degrees % 360) + 360) % 360) as number;
  const b = a > 180 ? a - 360 : a;
  // No negative zero.
  return b === 0 ? 0 : b;
}

/**
 * R5: the outline of a section around its seats, given its rows front first, each row's seats
 * in order (left to right as seen from the floor). The first seat of each row front to back,
 * then the last seat of each row back to front, each pushed out 1.5 units: along its row at the
 * sides, and at the front and back rows' corners also forward or back; along a curved front or
 * back row, the seats between its ends too, where the edge would otherwise come nearer them. So
 * a curved block, or one with rows of different lengths, gets a snug outline, not its hull. At
 * most 64 points: with many rows, the front, the back and evenly spaced rows between.
 *
 * One row: a rectangle 1.5 units around it, along it. One seat: a square.
 */
export function outlineAround(rowsIn: readonly (readonly Pt[])[]): [number, number][] {
  const rows = rowsIn.filter((r) => r.length > 0);
  if (rows.length === 0) throw new Error('outlineAround needs at least one seat');
  const m = OUTLINE_MARGIN;
  /** A box 1.5 units around every seat: one seat's square, or seats with no direction to follow. */
  const box = (): [number, number][] => {
    const all = rows.flat();
    const x0 = Math.min(...all.map((p) => p[0])) - m;
    const x1 = Math.max(...all.map((p) => p[0])) + m;
    const y0 = Math.min(...all.map((p) => p[1])) - m;
    const y1 = Math.max(...all.map((p) => p[1])) + m;
    const corners: Pt[] = [
      [x0, y1],
      [x0, y0],
      [x1, y0],
      [x1, y1],
    ];
    return corners.map(clean);
  };

  if (rows.length === 1) {
    const row = rows[0];
    // One seat, or a row whose ends are on top of each other (review M1): no direction to follow.
    if (row.length === 1 || length(sub(row[row.length - 1], row[0])) < 1e-9) return box();
    // Along the row: from its first seat to its last, and across it.
    const t = unit(sub(row[row.length - 1], row[0]));
    const n = perp(t);
    const along = row.map((p) => dot(p, t));
    const across = row.map((p) => dot(p, n));
    const t0 = Math.min(...along) - m;
    const t1 = Math.max(...along) + m;
    const n0 = Math.min(...across) - m;
    const n1 = Math.max(...across) + m;
    const at = (a: number, b: number): [number, number] => add(scale(t, a), scale(n, b));
    // The side toward +n first, so a row along +x reads front-left, back-left, back-right, ….
    return [at(t0, n1), at(t0, n0), at(t1, n0), at(t1, n1)].map(clean);
  }

  // Each row's direction where it has two seats or more, else its nearest such row's; a section of
  // one-seat rows only runs across, at right angles to the line from its back to its front.
  const own = rows.map((r) => (r.length > 1 ? unit(sub(r[r.length - 1], r[0])) : null));
  const front = mean(rows[0]);
  const back = mean(rows[rows.length - 1]);
  const fallback = perp(unit(sub(front, back)));
  const dirOf = (k: number): [number, number] => {
    for (let d = 0; d < rows.length; d++) {
      const a = own[k - d];
      if (a) return a;
      const b = own[k + d];
      if (b) return b;
    }
    return fallback;
  };
  /** The direction along row `k` at seat `i`, from its neighbours. */
  const tangent = (k: number, i: number): [number, number] => {
    const r = rows[k];
    if (r.length === 1) return dirOf(k);
    const a = r[Math.max(0, i - 1)];
    const b = r[Math.min(r.length - 1, i + 1)];
    return unit(sub(b, a));
  };
  /** At right angles to the row at seat `i`, on the side of `away`. */
  const normal = (k: number, i: number, away: Pt): [number, number] => {
    const n = perp(tangent(k, i));
    return dot(n, away) >= 0 ? n : scale(n, -1);
  };

  const last = rows.length - 1;
  const forward = unit(sub(front, mean(rows[1])));
  const backward = unit(sub(back, mean(rows[last - 1])));

  const corner = (k: number, first: boolean, away: Pt): [number, number] => {
    const r = rows[k];
    const i = first ? 0 : r.length - 1;
    const along = scale(tangent(k, i), first ? -1 : 1);
    return add(r[i], scale(unit(add(along, normal(k, i, away))), m));
  };
  const side = (k: number, first: boolean): [number, number] => {
    const r = rows[k];
    const i = first ? 0 : r.length - 1;
    return add(r[i], scale(tangent(k, i), first ? -m : m));
  };
  const edge = (k: number, away: Pt): [number, number][] =>
    rows[k].slice(1, -1).map((p, j) => add(p, scale(normal(k, j + 1, away), m)));

  // The front and back edges, left to right, each with as few points as keep it near its seats.
  let tolerance = EDGE_TOLERANCE;
  let frontEdge: [number, number][];
  let backEdge: [number, number][];
  const fl = corner(0, true, forward);
  const fr = corner(0, false, forward);
  const bl = corner(last, true, backward);
  const br = corner(last, false, backward);
  const frontAll = edge(0, forward);
  const backAll = edge(last, backward);
  for (;;) {
    frontEdge = simplify([fl, ...frontAll, fr], tolerance).slice(1, -1);
    backEdge = simplify([bl, ...backAll, br], tolerance).slice(1, -1);
    if (4 + frontEdge.length + backEdge.length <= LAYOUT_LIMITS.maxOutlinePoints - 2) break;
    tolerance *= 2;
  }

  // The rows between the front and the back whose ends are kept: all of them when they fit.
  const room = Math.floor(
    (LAYOUT_LIMITS.maxOutlinePoints - 4 - frontEdge.length - backEdge.length) / 2,
  );
  const between = last - 1;
  const middle: number[] =
    between <= room
      ? Array.from({ length: between }, (_, i) => i + 1)
      : Array.from({ length: room }, (_, i) => 1 + Math.round(((i + 1) * between) / (room + 1)));
  const kept = [...new Set(middle)].filter((k) => k > 0 && k < last);

  const ring: [number, number][] = [
    fl,
    ...kept.map((k) => side(k, true)),
    bl,
    ...backEdge,
    br,
    ...[...kept].reverse().map((k) => side(k, false)),
    fr,
    ...[...frontEdge].reverse(),
  ];
  const out = dropRepeats(ring).map(clean);
  // Seats on top of each other leave too few points for an outline (review M1).
  return new Set(out.map((p) => `${p[0]},${p[1]}`)).size >= 3 ? out : box();
}

/** Douglas–Peucker: the points of a chain that keep it within `tolerance` of every point left out. */
function simplify(chain: [number, number][], tolerance: number): [number, number][] {
  if (chain.length <= 2) return chain;
  const keep = new Array<boolean>(chain.length).fill(false);
  keep[0] = true;
  keep[chain.length - 1] = true;
  const stack: [number, number][] = [[0, chain.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(chain[i], chain[a], chain[b]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  return chain.filter((_, i) => keep[i]);
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return length(sub(p, add(a, scale(ab, t))));
}

/** Without a point that repeats the one before it (a one-seat row's two ends). */
function dropRepeats(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || length(sub(p, prev)) > 1e-9) out.push(p);
  }
  while (out.length > 1 && length(sub(out[0], out[out.length - 1])) <= 1e-9) out.pop();
  return out;
}

/** No `-0`, and no float dust past a billionth. */
const clean = (p: Pt): [number, number] => [tidy(p[0]), tidy(p[1])];
const tidy = (v: number): number => {
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
};

// ------------------------------------------------------------------------------ block generator

/** `SectionGenerator` of the contract: what a section was generated from. */
export type BlockValues = components['schemas']['SectionGenerator'];

export interface BlockSeat {
  label: string;
  at: [number, number];
}
export interface BlockRow {
  label: string;
  seats: BlockSeat[];
}
/** A generated block: rows front first, seats left to right as seen from the floor. */
export interface Block {
  rows: BlockRow[];
}

/** A value of the generator that can't be used, with the form field it belongs to. */
export interface BlockProblem {
  field: keyof BlockValues;
  message: string;
}

export class BlockError extends Error {
  constructor(readonly problems: BlockProblem[]) {
    super(problems.map((p) => p.message).join('; '));
    this.name = 'BlockError';
  }
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A letter label's place in A … Z, AA … ZZ, AAA …, or null when it is not one. */
function letterIndex(label: string): number | null {
  const s = label.toUpperCase();
  if (!/^([A-Z])\1*$/.test(s)) return null;
  return LETTERS.indexOf(s[0]) + 26 * (s.length - 1);
}
const letterLabel = (i: number): string => LETTERS[i % 26].repeat(Math.floor(i / 26) + 1);

/**
 * R7: `count` row labels from `first`: letters run A … Z, AA … ZZ (one letter repeated), AAA …;
 * numbers count up. Throws a `BlockError` when `first` isn't in the style or a label would be
 * longer than 5 characters.
 */
export function rowLabels(style: BlockValues['rowLabels'], first: string, count: number): string[] {
  const problems = labelProblems(style, first, count);
  if (problems.length > 0) throw new BlockError(problems);
  if (style === 'NUMBERS') {
    const start = Number(first.trim());
    return Array.from({ length: count }, (_, i) => String(start + i));
  }
  const start = letterIndex(first.trim()) as number;
  return Array.from({ length: count }, (_, i) => letterLabel(start + i));
}

function labelProblems(
  style: BlockValues['rowLabels'],
  first: string,
  count: number,
): BlockProblem[] {
  const max = LAYOUT_LIMITS.labelMaxLength;
  const s = first.trim();
  if (style === 'NUMBERS') {
    if (!/^\d{1,5}$/.test(s)) {
      return [{ field: 'firstRow', message: 'The first row is a whole number, such as 1' }];
    }
    if (String(Number(s) + Math.max(0, count - 1)).length > max) {
      return [{ field: 'firstRow', message: `Row labels would run past ${max} characters` }];
    }
    return [];
  }
  const start = letterIndex(s);
  if (start === null) {
    return [
      {
        field: 'firstRow',
        message: 'The first row is a letter, or one letter repeated (A, AA, AAA)',
      },
    ];
  }
  if (letterLabel(start + Math.max(0, count - 1)).length > max) {
    return [{ field: 'firstRow', message: `Row labels would run past ${'Z'.repeat(max)}` }];
  }
  return [];
}

/** R7, FR-006: every problem with the generator's values, by field, naming each limit. */
export function checkBlock(v: BlockValues): BlockProblem[] {
  const problems: BlockProblem[] = [];
  const { maxRows, maxSeatsPerRow } = LAYOUT_LIMITS;
  const rowsOk = Number.isInteger(v.rows) && v.rows >= 1 && v.rows <= maxRows;
  if (!Number.isInteger(v.rows) || v.rows < 1) {
    problems.push({ field: 'rows', message: 'At least 1 row' });
  } else if (v.rows > maxRows) {
    problems.push({ field: 'rows', message: `At most ${maxRows} rows` });
  }
  const list = v.seatsPerRow;
  if (!Array.isArray(list) || list.length === 0) {
    problems.push({ field: 'seatsPerRow', message: 'Seats per row: one number, or one a row' });
  } else {
    if (list.some((n) => !Number.isInteger(n) || n < 1)) {
      problems.push({ field: 'seatsPerRow', message: 'At least 1 seat in a row' });
    } else if (list.some((n) => n > maxSeatsPerRow)) {
      problems.push({ field: 'seatsPerRow', message: `At most ${maxSeatsPerRow} seats in a row` });
    }
    if (list.length !== 1 && rowsOk && list.length !== v.rows) {
      problems.push({
        field: 'seatsPerRow',
        message: `Give one number for every row, or one for each of the ${v.rows} rows`,
      });
    }
  }
  if (rowsOk) problems.push(...labelProblems(v.rowLabels, v.firstRow ?? '', v.rows));
  else if (labelProblems(v.rowLabels, v.firstRow ?? '', 1).length > 0) {
    problems.push(...labelProblems(v.rowLabels, v.firstRow ?? '', 1));
  }
  if (!Number.isInteger(v.firstSeat) || v.firstSeat < 1 || v.firstSeat > 9999) {
    problems.push({
      field: 'firstSeat',
      message: 'The first seat is a whole number from 1 to 9,999',
    });
  }
  if (typeof v.curve !== 'number' || !Number.isFinite(v.curve) || v.curve < 0 || v.curve > 120) {
    problems.push({ field: 'curve', message: 'The curve is from 0 to 120 degrees' });
  }
  return problems;
}

/** The seats of each row, front first, from the generator's values. */
export function seatCounts(v: BlockValues): number[] {
  return Array.from({ length: v.rows }, (_, k) =>
    v.seatsPerRow.length === 1 ? v.seatsPerRow[0] : v.seatsPerRow[k],
  );
}

/**
 * R7: a block of seats in its own frame. The origin is the middle of the front row; rows go back
 * toward `-y`, so the block faces down the map. Straight: row `k` seat `i` of `n` at
 * `((i − (n − 1) / 2) × 2, −2k)`. Curved (`curve` degrees of the front row's arc): every row an
 * arc about `(0, R₀)` on the floor side, `R₀ = 2(n₀ − 1) / curve` in radians (at least 2), row
 * `k` of radius `R₀ + 2k`, its seats 2 apart along it, centered. Seats listed left to right;
 * their labels run from `firstSeat` in `direction`. Throws a `BlockError` for bad values.
 */
export function generateBlock(v: BlockValues): Block {
  const problems = checkBlock(v);
  if (problems.length > 0) throw new BlockError(problems);
  const counts = seatCounts(v);
  const labels = rowLabels(v.rowLabels, v.firstRow, v.rows);
  const curve = (v.curve * Math.PI) / 180;
  const r0 = curve > 0 ? Math.max(ROW_GAP, (SEAT_GAP * (counts[0] - 1)) / curve) : 0;

  return {
    rows: counts.map((n, k) => {
      const seats = Array.from({ length: n }, (_, i): BlockSeat => {
        const offset = (i - (n - 1) / 2) * SEAT_GAP;
        let at: [number, number];
        if (curve > 0) {
          const radius = r0 + ROW_GAP * k;
          const a = offset / radius;
          at = [radius * Math.sin(a), r0 - radius * Math.cos(a)];
        } else at = [offset, -ROW_GAP * k];
        const label = v.direction === 'LEFT_TO_RIGHT' ? v.firstSeat + i : v.firstSeat + n - 1 - i;
        return { label: String(label), at: clean(at) };
      });
      return { label: labels[k], seats };
    }),
  };
}

/** A block turned `angle` degrees clockwise about its origin, then moved to `origin`. */
export function placeBlock(block: Block, origin: Pt, angle: number): Block {
  return {
    rows: block.rows.map((r) => ({
      label: r.label,
      seats: r.seats.map((s) => {
        const [p] = turnAbout([s.at], [0, 0], angle);
        return { label: s.label, at: [p[0] + origin[0], p[1] + origin[1]] };
      }),
    })),
  };
}
