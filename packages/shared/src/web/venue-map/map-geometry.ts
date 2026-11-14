/**
 * Spec 038 research R13 (T018): the shared venue map's geometry. Places are the layout's map
 * units, `y` growing downward as in SVG, so an outline is drawn as it is, with no transform.
 */
export type Point = readonly [number, number];

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An outline as a closed SVG path: `M x y L x y … Z`. */
export function outlinePath(points: readonly Point[]): string {
  return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join('')}Z`;
}

/** The smallest rectangle around the points. */
export function bounds(points: readonly Point[]): Bounds {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * A polygon's centroid, the center of its area (where a section's name goes when its layout file
 * gives none, research R5); the average of its points when it has no area.
 */
export function centroid(points: readonly Point[]): [number, number] {
  let area = 0;
  let cx = 0;
  let cy = 0;
  points.forEach(([x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  });
  if (Math.abs(area) < 1e-9) {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/** A section's `viewBox`: its bounds with `margin` map units on every side (4 by default). */
export function sectionViewBox(outline: readonly Point[], margin = 4): string {
  const b = bounds(outline);
  return `${b.x - margin} ${b.y - margin} ${b.width + 2 * margin} ${b.height + 2 * margin}`;
}
