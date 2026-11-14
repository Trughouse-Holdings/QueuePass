/** A point in map units, `[x, y]`, `y` growing downward (spec 038 research R5). */
export type Point = [number, number];

/** Spec 038 research R5 (contracts/openapi.yaml `LayoutFileSeatRun`). */
export interface SeatRun {
  first: number;
  count: number;
  from: Point;
  to: Point;
  bend?: Point;
}

/**
 * Spec 038 research R5: a run's seats, in order: `count` seats labelled `first`, `first + 1`, …,
 * spaced evenly in the curve's parameter from `from` to `to`. With `bend`, the curve is the
 * quadratic Bézier curve that passes through `bend` halfway (its control point is
 * `2·bend − (from + to)/2`); without, the straight line. A run of one seat is at `from`.
 */
export function expandRun(run: SeatRun): { label: string; at: Point }[] {
  const { first, count, from, to, bend } = run;
  const control: Point | null = bend
    ? [2 * bend[0] - (from[0] + to[0]) / 2, 2 * bend[1] - (from[1] + to[1]) / 2]
    : null;
  return Array.from({ length: count }, (_, i) => {
    let at: Point;
    if (count === 1) at = [from[0], from[1]];
    else if (!control) {
      // (to − from)·i/(count − 1), multiplied first, so whole spacings stay whole numbers.
      at = [
        from[0] + ((to[0] - from[0]) * i) / (count - 1),
        from[1] + ((to[1] - from[1]) * i) / (count - 1),
      ];
    } else {
      const t = i / (count - 1);
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      at = [a * from[0] + b * control[0] + c * to[0], a * from[1] + b * control[1] + c * to[1]];
    }
    return { label: String(first + i), at };
  });
}
