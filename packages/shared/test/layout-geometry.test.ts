import { describe, expect, it } from 'vitest';
import * as shared from '../src/index';
import {
  BlockError,
  OUTLINE_MARGIN,
  ROW_GAP,
  SEAT_GAP,
  SIZE_MARGIN,
  checkBlock,
  generateBlock,
  moveBy,
  normalizeAngle,
  outlineAround,
  placeBlock,
  rowLabels,
  turnAbout,
  type BlockValues,
  type Pt,
} from '../src/layout-geometry';

/**
 * Spec 039 research R5, R6, R7 (T004, T024): the layout editor's geometry, shared by the editor
 * (drawing outlines live) and the Backend (drawing the outline it saves), seat by seat.
 */

const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const close = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.every((v, i) => Math.abs(v - b[i]) < eps);

/** A straight block of rows (seat counts), row k at y = -2k, centered on x = 0. */
const straight = (counts: number[]): Pt[][] =>
  counts.map((n, k) =>
    Array.from({ length: n }, (_, i): Pt => [(i - (n - 1) / 2) * SEAT_GAP, -ROW_GAP * k]),
  );

const values = (over: Partial<BlockValues> = {}): BlockValues => ({
  rows: 3,
  seatsPerRow: [4],
  rowLabels: 'LETTERS',
  firstRow: 'A',
  firstSeat: 1,
  direction: 'LEFT_TO_RIGHT',
  curve: 0,
  ...over,
});

describe('constants', () => {
  it('are the standard spacing and margins (R5, R7)', () => {
    expect([SEAT_GAP, ROW_GAP, OUTLINE_MARGIN, SIZE_MARGIN]).toEqual([2, 2, 1.5, 10]);
  });

  it('are exported from the package with the functions', () => {
    expect(shared.outlineAround).toBe(outlineAround);
    expect(shared.generateBlock).toBe(generateBlock);
    expect(shared.normalizeAngle).toBe(normalizeAngle);
  });
});

describe('outlineAround (R5)', () => {
  it('for a 3 × 4 straight block: the first seats front to back, then the last seats back to front, each 1.5 out', () => {
    const rows = straight([4, 4, 4]);
    const out = outlineAround(rows);
    const d = OUTLINE_MARGIN / Math.SQRT2;
    // Front first seat out to the left and forward; the middle row's ends out along the row;
    // the back row's corners out to the side and back.
    const want: Pt[] = [
      [-3 - d, 0 + d],
      [-3 - 1.5, -2],
      [-3 - d, -4 - d],
      [3 + d, -4 - d],
      [3 + 1.5, -2],
      [3 + d, 0 + d],
    ];
    expect(out).toHaveLength(6);
    out.forEach((p, i) => expect(close(p, want[i])).toBe(true));
    // Closed by the drawing (a polygon), not by repeating its first point.
    expect(close(out[0], out[out.length - 1])).toBe(false);
    // Each point is exactly 1.5 from the seat it was pushed out from.
    const seats = rows.flat();
    for (const p of out) {
      expect(Math.min(...seats.map((s) => dist(p, s)))).toBeCloseTo(1.5, 9);
    }
  });

  it('for a curved block hugs the arcs: every point within 1.5 of a seat, and every seat inside', () => {
    const block = generateBlock(values({ rows: 12, seatsPerRow: [20], curve: 40 }));
    const rows = block.rows.map((r) => r.seats.map((s) => s.at));
    const out = outlineAround(rows);
    const seats = rows.flat();
    for (const p of out) {
      expect(Math.min(...seats.map((s) => dist(p, s)))).toBeLessThanOrEqual(1.5 + 1e-6);
    }
    for (const s of seats) expect(inside(s, out)).toBe(true);
    // The front row's middle is near the front edge: no hollow is covered in front of it.
    const frontMiddle: Pt = [0, 1.4];
    expect(inside(frontMiddle, out)).toBe(true);
    expect(inside([0, 3.5], out)).toBe(false);
    expect(out.length).toBeGreaterThan(6);
    expect(out.length).toBeLessThanOrEqual(64);
  });

  it("for rows of different lengths follows each row's ends", () => {
    const rows = straight([4, 6, 4]);
    const out = outlineAround(rows);
    // The middle row's ends, 1.5 beyond its first and last seats.
    expect(out.some((p) => close(p, [-5 - 1.5, -2]))).toBe(true);
    expect(out.some((p) => close(p, [5 + 1.5, -2]))).toBe(true);
    for (const s of rows.flat()) expect(inside(s, out)).toBe(true);
  });

  it("for 100 rows has at most 64 points and keeps the front and back rows' ends", () => {
    const block = generateBlock(values({ rows: 100, seatsPerRow: [30], curve: 30 }));
    const rows = block.rows.map((r) => r.seats.map((s) => s.at));
    const out = outlineAround(rows);
    expect(out.length).toBeLessThanOrEqual(64);
    const ends = [rows[0][0], rows[0][29], rows[99][0], rows[99][29]];
    for (const e of ends) {
      expect(out.some((p) => Math.abs(dist(p, e) - 1.5) < 1e-9)).toBe(true);
    }
  });

  it('for 200 seats in a strongly curved row still keeps within 64 points', () => {
    const block = generateBlock(values({ rows: 3, seatsPerRow: [200], curve: 120 }));
    const out = outlineAround(block.rows.map((r) => r.seats.map((s) => s.at)));
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('for one row gives a 4-point rectangle 1.5 around the row', () => {
    const out = outlineAround(straight([5]));
    expect(out).toEqual([
      [-4 - 1.5, 1.5],
      [-4 - 1.5, -1.5],
      [4 + 1.5, -1.5],
      [4 + 1.5, 1.5],
    ]);
  });

  it('for one row turned 90° the rectangle turns with it', () => {
    const row = turnAbout(straight([3])[0], [0, 0], 90);
    const out = outlineAround([row]);
    expect(out).toHaveLength(4);
    for (const s of row) expect(inside(s, out)).toBe(true);
    const xs = out.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3, 9);
  });

  it('for one seat gives a 4-point square', () => {
    expect(outlineAround([[[10, 20]]])).toEqual([
      [8.5, 21.5],
      [8.5, 18.5],
      [11.5, 18.5],
      [11.5, 21.5],
    ]);
  });

  it('for a column of one-seat rows still draws around every seat', () => {
    const rows: Pt[][] = [[[0, 0]], [[0, -2]], [[0, -4]]];
    const out = outlineAround(rows);
    for (const s of rows.flat()) expect(inside(s, out)).toBe(true);
  });

  it('for rows mixing one seat and many draws around every seat', () => {
    const rows: Pt[][] = [[[0, 0]], ...straight([1, 5]).slice(1)];
    const out = outlineAround(rows);
    for (const s of rows.flat()) expect(inside(s, out)).toBe(true);
  });
});

describe('moveBy, turnAbout, normalizeAngle (R6)', () => {
  it('moves every point', () => {
    expect(
      moveBy(
        [
          [1, 2],
          [3, 4],
        ],
        10,
        -1,
      ),
    ).toEqual([
      [11, 1],
      [13, 3],
    ]);
  });

  it('turns clockwise with y down: (1, 0) about (0, 0) by 90° is (0, 1)', () => {
    const [p] = turnAbout([[1, 0]], [0, 0], 90);
    expect(close(p, [0, 1])).toBe(true);
    const [q] = turnAbout([[12, 5]], [10, 5], -90);
    expect(close(q, [10, 3])).toBe(true);
  });

  it('keeps angles in (-180, 180]', () => {
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(45)).toBe(45);
    expect(normalizeAngle(-725)).toBe(-5);
  });
});

describe('generateBlock (R7)', () => {
  it('3 rows × 4 straight: row k seat i at ((i − 1.5) × 2, −2k)', () => {
    const block = generateBlock(values());
    expect(block.rows.map((r) => r.label)).toEqual(['A', 'B', 'C']);
    block.rows.forEach((row, k) => {
      expect(row.seats.map((s) => s.label)).toEqual(['1', '2', '3', '4']);
      row.seats.forEach((s, i) => expect(close(s.at, [(i - 1.5) * 2, -2 * k])).toBe(true));
    });
  });

  it('rows [4, 6]: the second row centered on the first', () => {
    const block = generateBlock(values({ rows: 2, seatsPerRow: [4, 6] }));
    expect(block.rows[1].seats.map((s) => s.at[0])).toEqual([-5, -3, -1, 1, 3, 5]);
    expect(block.rows[0].seats.map((s) => s.at[0])).toEqual([-3, -1, 1, 3]);
  });

  it('curve 40 with [20, 20, 20]: rows on arcs about (0, R₀), seats 2 apart along them', () => {
    const block = generateBlock(values({ seatsPerRow: [20, 20, 20], curve: 40 }));
    const r0 = (2 * 19) / ((40 * Math.PI) / 180);
    const center: Pt = [0, r0];
    block.rows.forEach((row, k) => {
      const rk = r0 + 2 * k;
      for (const s of row.seats) expect(Math.abs(dist(s.at, center) - rk)).toBeLessThan(1e-6);
      for (let i = 1; i < row.seats.length; i++) {
        const a = Math.atan2(row.seats[i].at[0], center[1] - row.seats[i].at[1]);
        const b = Math.atan2(row.seats[i - 1].at[0], center[1] - row.seats[i - 1].at[1]);
        expect(Math.abs((a - b) * rk - 2)).toBeLessThan(1e-6);
      }
      // Symmetric about x = 0.
      const n = row.seats.length;
      for (let i = 0; i < n; i++) {
        const s = row.seats[i].at;
        const m = row.seats[n - 1 - i].at;
        expect(Math.abs(s[0] + m[0])).toBeLessThan(1e-6);
        expect(Math.abs(s[1] - m[1])).toBeLessThan(1e-6);
      }
    });
    // The front row's middle is the origin; its ends curve toward the floor (+y).
    const front = block.rows[0].seats;
    expect(front[0].at[1]).toBeGreaterThan(0);
    expect(Math.abs(front[9].at[0] + front[10].at[0])).toBeLessThan(1e-9);
  });

  it('a curve so small that R₀ < 2 uses R₀ = 2', () => {
    const block = generateBlock(values({ rows: 2, seatsPerRow: [1], curve: 120 }));
    expect(close(block.rows[0].seats[0].at, [0, 0])).toBe(true);
    expect(Math.abs(dist(block.rows[1].seats[0].at, [0, 2]) - 4)).toBeLessThan(1e-9);
  });

  it('letters from A for 30 rows end Z, AA, BB, CC, DD; from Y: Y, Z, AA', () => {
    expect(rowLabels('LETTERS', 'A', 30).slice(-5)).toEqual(['Z', 'AA', 'BB', 'CC', 'DD']);
    expect(rowLabels('LETTERS', 'Y', 3)).toEqual(['Y', 'Z', 'AA']);
    expect(rowLabels('LETTERS', 'ZZ', 2)).toEqual(['ZZ', 'AAA']);
    expect(rowLabels('LETTERS', 'b', 2)).toEqual(['B', 'C']);
  });

  it('numbers from 99: 99, 100', () => {
    expect(rowLabels('NUMBERS', '99', 2)).toEqual(['99', '100']);
  });

  it('seats from 101 right to left: listed left to right, the leftmost labelled last', () => {
    const block = generateBlock(
      values({ rows: 1, seatsPerRow: [4], firstSeat: 101, direction: 'RIGHT_TO_LEFT' }),
    );
    expect(block.rows[0].seats.map((s) => s.label)).toEqual(['104', '103', '102', '101']);
    const xs = block.rows[0].seats.map((s) => s.at[0]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('the origin is the middle of the front row', () => {
    const block = generateBlock(values({ rows: 4, seatsPerRow: [5], curve: 60 }));
    expect(close(block.rows[0].seats[2].at, [0, 0])).toBe(true);
  });

  it.each([
    ['a first row not in the letter sequence', { firstRow: 'AB' }, 'firstRow'],
    ['a first row that is not a number', { rowLabels: 'NUMBERS', firstRow: 'A' }, 'firstRow'],
    ['labels past five characters', { rows: 30, firstRow: 'ZZZZ' }, 'firstRow'],
    ['101 rows', { rows: 101 }, 'rows'],
    ['0 rows', { rows: 0 }, 'rows'],
    ['201 seats a row', { seatsPerRow: [201] }, 'seatsPerRow'],
    ['0 seats a row', { seatsPerRow: [0] }, 'seatsPerRow'],
    ['a list neither 1 long nor one per row', { seatsPerRow: [4, 4] }, 'seatsPerRow'],
    ['a curve of 121', { curve: 121 }, 'curve'],
    ['a first seat of 0', { firstSeat: 0 }, 'firstSeat'],
  ] as const)('refuses %s', (_what, over, field) => {
    const v = values(over as Partial<BlockValues>);
    expect(checkBlock(v).map((p) => p.field)).toContain(field);
    expect(() => generateBlock(v)).toThrow(BlockError);
  });

  it('names the limit it refuses', () => {
    expect(checkBlock(values({ rows: 101 }))).toContainEqual({
      field: 'rows',
      message: 'At most 100 rows',
    });
    expect(checkBlock(values({ seatsPerRow: [201] }))).toContainEqual({
      field: 'seatsPerRow',
      message: 'At most 200 seats in a row',
    });
  });
});

describe('placeBlock (R6, R7)', () => {
  it('turns the block about its origin, then moves it there', () => {
    const block = generateBlock(values({ rows: 1, seatsPerRow: [3] }));
    const placed = placeBlock(block, [100, 50], 90);
    // Turned 90° clockwise, the row runs down the map.
    expect(placed.rows[0].seats.map((s) => s.at.map((v) => Math.round(v * 1e9) / 1e9))).toEqual([
      [100, 48],
      [100, 50],
      [100, 52],
    ]);
  });
});

/** Ray casting: whether `p` is inside the polygon. */
function inside(p: Pt, poly: readonly Pt[]): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) yes = !yes;
  }
  return yes;
}
