import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bounds, Point } from './map-geometry.js';

/**
 * Spec 038 research R13 (T039, FR-018): the venue map's pan and zoom, our own, over the SVG
 * `viewBox` (no library: d3-zoom works on transforms jsdom doesn't compute). The view is a
 * rectangle of map units; the SVG shows it with `xMidYMid meet`. Wheel, drag, a two-finger pinch
 * (Pointer Events), `+`/`−` and the arrow keys, and the map's zoom buttons; zooming to a section
 * animates for 200 ms, and not at all under `prefers-reduced-motion`.
 */
export interface View {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The deepest zoom, 40 times the whole map (R13). */
export const MAX_ZOOM = 40;
const ANIMATION_MS = 200;
/** One press of a zoom button or key. */
const STEP = 1.5;
/** How far one pixel of wheel travel zooms. */
const WHEEL_RATE = 0.002;
/** A press that moves less than this many pixels is a click, not a drag. */
const DRAG_SLOP = 4;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Bounds with `margin` map units on every side. */
export function fitView(b: Bounds, margin = 0): View {
  return {
    x: b.x - margin,
    y: b.y - margin,
    width: b.width + 2 * margin,
    height: b.height + 2 * margin,
  };
}

/** How far in a view is: 1 at the fit. */
export const zoomOf = (view: View, fit: View): number => fit.width / view.width;

/**
 * Zooms by `factor` at the map place `at`, which keeps its place on screen; never out past the
 * fit (where the view is the fit again) nor in past `maxZoom`.
 */
export function zoomAt(view: View, factor: number, at: Point, fit: View, maxZoom = MAX_ZOOM): View {
  const current = zoomOf(view, fit);
  const next = clamp(current * factor, 1, maxZoom);
  if (next <= 1) return fit;
  const k = current / next;
  return {
    x: at[0] - (at[0] - view.x) * k,
    y: at[1] - (at[1] - view.y) * k,
    width: view.width * k,
    height: view.height * k,
  };
}

/** Moves the view by map units, its center kept over the map. */
export function panBy(view: View, dx: number, dy: number, fit: View): View {
  const cx = clamp(view.x + dx + view.width / 2, fit.x, fit.x + fit.width);
  const cy = clamp(view.y + dy + view.height / 2, fit.y, fit.y + fit.height);
  return { ...view, x: cx - view.width / 2, y: cy - view.height / 2 };
}

/** The map place under a point on screen, the view drawn centered in `rect` (meet). */
export function clientToMap(view: View, rect: Rect, client: Point): [number, number] {
  const scale = Math.min(rect.width / view.width, rect.height / view.height);
  const offX = (rect.width - view.width * scale) / 2;
  const offY = (rect.height - view.height * scale) / 2;
  return [
    view.x + (client[0] - rect.left - offX) / scale,
    view.y + (client[1] - rect.top - offY) / scale,
  ];
}

const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const middle = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * Two fingers moved from `before` to `after` (screen points): zoomed by how much further apart they
 * are, around their middle, and moved with it, so the map stays under the fingers.
 */
export function pinchView(
  view: View,
  fit: View,
  rect: Rect,
  before: readonly [Point, Point],
  after: readonly [Point, Point],
): View {
  const d0 = distance(before[0], before[1]);
  const factor = d0 > 0 ? distance(after[0], after[1]) / d0 : 1;
  const p = clientToMap(view, rect, middle(before[0], before[1]));
  const zoomed = zoomAt(view, factor, p, fit);
  const q = clientToMap(zoomed, rect, middle(after[0], after[1]));
  return panBy(zoomed, p[0] - q[0], p[1] - q[1], fit);
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Frame = (cb: () => void) => unknown;
const nextFrame: Frame = (cb) =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(() => cb())
    : setTimeout(cb, 16);

export interface PanZoom {
  view: View;
  /** The view as the SVG's `viewBox`. */
  viewBox: string;
  /** 1 at the fit, up to 40. */
  zoom: number;
  /** For the SVG element: its size on screen, and the wheel (which must not scroll the page). */
  ref: (el: SVGSVGElement | null) => void;
  zoomIn(): void;
  zoomOut(): void;
  /** The whole map, at once. */
  fit(): void;
  /** A section's bounds with a margin (a tenth of its larger side unless given), animated. */
  zoomTo(bounds: Bounds, margin?: number): void;
  onPointerDown(e: React.PointerEvent): void;
  onPointerMove(e: React.PointerEvent): void;
  onPointerUp(e: React.PointerEvent): void;
  onKeyDown(e: React.KeyboardEvent): void;
  /** Whether the last press was a drag, so the click that ends it chooses nothing. */
  dragged(): boolean;
}

export function usePanZoom(fit: View): PanZoom {
  const [view, setViewState] = useState<View>(fit);
  const viewRef = useRef(view);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const el = useRef<SVGSVGElement | null>(null);
  const animation = useRef(0);
  const pointers = useRef(new Map<number, Point>());
  const pressedAt = useRef<Point | null>(null);
  const wasDrag = useRef(false);
  const dragging = useRef(false);

  const setView = useCallback((v: View): void => {
    viewRef.current = v;
    setViewState(v);
  }, []);
  /** Any move by the person stops an animation on its way. */
  const stop = (): void => {
    animation.current += 1;
  };
  const rect = (): Rect => {
    const r = el.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0
      ? r
      : { left: 0, top: 0, width: fitRef.current.width, height: fitRef.current.height };
  };
  const center = (v: View): Point => [v.x + v.width / 2, v.y + v.height / 2];

  // A different map: start again at its fit.
  const { x, y, width, height } = fit;
  useEffect(() => {
    animation.current += 1;
    setView({ x, y, width, height });
  }, [x, y, width, height, setView]);

  const zoomBy = useCallback(
    (factor: number): void => {
      stop();
      setView(zoomAt(viewRef.current, factor, center(viewRef.current), fitRef.current));
    },
    [setView],
  );

  const animateTo = useCallback(
    (target: View): void => {
      const id = ++animation.current;
      if (reducedMotion()) {
        setView(target);
        return;
      }
      const from = viewRef.current;
      const start = performance.now();
      const step = (): void => {
        if (animation.current !== id) return;
        const t = Math.min(1, (performance.now() - start) / ANIMATION_MS);
        const e = 1 - (1 - t) ** 3;
        setView({
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          width: from.width + (target.width - from.width) * e,
          height: from.height + (target.height - from.height) * e,
        });
        if (t < 1) nextFrame(step);
      };
      nextFrame(step);
    },
    [setView],
  );

  const zoomTo = useCallback(
    (b: Bounds, margin?: number): void => {
      let target = fitView(b, margin ?? Math.max(b.width, b.height) / 10);
      const f = fitRef.current;
      // Not deeper than the deepest zoom: widened around its center.
      if (zoomOf(target, f) > MAX_ZOOM) {
        const k = zoomOf(target, f) / MAX_ZOOM;
        const [cx, cy] = center(target);
        target = {
          x: cx - (target.width * k) / 2,
          y: cy - (target.height * k) / 2,
          width: target.width * k,
          height: target.height * k,
        };
      }
      animateTo(target);
    },
    [animateTo],
  );

  /** At once: the Fit button, and Back to map, show the whole map without waiting. */
  const fitAll = useCallback((): void => {
    stop();
    setView(fitRef.current);
  }, [setView]);

  const onWheel = useCallback(
    (e: WheelEvent): void => {
      e.preventDefault();
      stop();
      // Lines and pages are about 16 and 400 pixels.
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const at = clientToMap(viewRef.current, rect(), [e.clientX, e.clientY]);
      setView(
        zoomAt(viewRef.current, Math.exp(-e.deltaY * scale * WHEEL_RATE), at, fitRef.current),
      );
    },
    // rect() reads refs only.
    [setView],
  );

  const ref = useCallback(
    (node: SVGSVGElement | null): void => {
      el.current?.removeEventListener('wheel', onWheel);
      el.current = node;
      // Not React's onWheel, which is passive: the page must not scroll under the map.
      node?.addEventListener('wheel', onWheel, { passive: false });
    },
    [onWheel],
  );

  const onPointerDown = (e: React.PointerEvent): void => {
    stop();
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 1) {
      pressedAt.current = [e.clientX, e.clientY];
      wasDrag.current = false;
      dragging.current = false;
    }
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now: Point = [e.clientX, e.clientY];
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size >= 2) {
      dragging.current = true;
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return;
      setView(pinchView(viewRef.current, fitRef.current, rect(), [prev, other], [now, other]));
      return;
    }
    if (!dragging.current) {
      if (!pressedAt.current || distance(pressedAt.current, now) < DRAG_SLOP) return;
      dragging.current = true;
      // Only now, so a plain click still reaches the section or seat it pressed.
      (e.currentTarget as Element | undefined)?.setPointerCapture?.(e.pointerId);
    }
    const r = rect();
    const v = viewRef.current;
    const unitsPerPixel = 1 / Math.min(r.width / v.width, r.height / v.height);
    setView(
      panBy(
        v,
        -(now[0] - prev[0]) * unitsPerPixel,
        -(now[1] - prev[1]) * unitsPerPixel,
        fitRef.current,
      ),
    );
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      wasDrag.current = dragging.current;
      dragging.current = false;
      pressedAt.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const v = viewRef.current;
    const moves: Record<string, () => void> = {
      '+': () => zoomBy(STEP),
      '=': () => zoomBy(STEP),
      '-': () => zoomBy(1 / STEP),
      '−': () => zoomBy(1 / STEP),
      _: () => zoomBy(1 / STEP),
      ArrowLeft: () => setView(panBy(v, -v.width / 10, 0, fitRef.current)),
      ArrowRight: () => setView(panBy(v, v.width / 10, 0, fitRef.current)),
      ArrowUp: () => setView(panBy(v, 0, -v.height / 10, fitRef.current)),
      ArrowDown: () => setView(panBy(v, 0, v.height / 10, fitRef.current)),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    stop();
    move();
  };

  return {
    view,
    viewBox: `${round(view.x)} ${round(view.y)} ${round(view.width)} ${round(view.height)}`,
    zoom: zoomOf(view, fit),
    ref,
    zoomIn: () => zoomBy(STEP),
    zoomOut: () => zoomBy(1 / STEP),
    fit: fitAll,
    zoomTo,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    dragged: () => wasDrag.current,
  };
}

/** A viewBox number, to a thousandth of a map unit. */
const round = (n: number): number => Math.round(n * 1000) / 1000;
