import { describe, it, expect } from 'vitest';
import {
  bounds,
  centroid,
  outlinePath,
  sectionViewBox,
} from '../../src/web/venue-map/map-geometry';

/**
 * Spec 038 research R13 (T018): the shared map's geometry. Places are map units, `y` down, as in
 * SVG, so an outline is drawn as it is.
 */
describe('map geometry (038)', () => {
  const square: [number, number][] = [
    [10, 20],
    [50, 20],
    [50, 60],
    [10, 60],
  ];

  it('draws an outline as a closed SVG path, point by point', () => {
    expect(outlinePath(square)).toBe('M10 20L50 20L50 60L10 60Z');
    expect(
      outlinePath([
        [0.5, 1.25],
        [3, 4],
        [5, 0],
      ]),
    ).toBe('M0.5 1.25L3 4L5 0Z');
  });

  it('gives the bounds of points', () => {
    expect(bounds(square)).toEqual({ x: 10, y: 20, width: 40, height: 40 });
    expect(
      bounds([
        [5, 9],
        [1, 3],
        [4, 12],
      ]),
    ).toEqual({ x: 1, y: 3, width: 4, height: 9 });
  });

  it("gives a polygon's centroid, its area's center, not its points' average", () => {
    expect(centroid(square)).toEqual([30, 40]);
    // An L shape: its points average elsewhere than its area's center.
    const ell: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ];
    const [x, y] = centroid(ell);
    expect(x).toBeCloseTo(25 / 3, 6);
    expect(y).toBeCloseTo(25 / 3, 6);
    // In either winding.
    const [rx, ry] = centroid([...ell].reverse());
    expect(rx).toBeCloseTo(25 / 3, 6);
    expect(ry).toBeCloseTo(25 / 3, 6);
  });

  it('falls back to the average of the points when the outline has no area', () => {
    expect(
      centroid([
        [0, 0],
        [10, 0],
        [20, 0],
      ]),
    ).toEqual([10, 0]);
  });

  it("gives a section's viewBox: its bounds with a margin on every side", () => {
    expect(sectionViewBox(square)).toBe('6 16 48 48');
    expect(sectionViewBox(square, 0)).toBe('10 20 40 40');
    expect(sectionViewBox(square, 10)).toBe('0 10 60 60');
  });
});
