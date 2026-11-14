import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  MAX_ZOOM,
  clientToMap,
  fitView,
  panBy,
  pinchView,
  usePanZoom,
  zoomAt,
  type View,
} from '../../src/web/venue-map/use-pan-zoom';
import { REDUCED_MOTION, setMediaQuery } from '../web/browser-stubs';

/**
 * Spec 038 research R13 (T031, FR-018): the venue map's own pan and zoom over the SVG `viewBox`
 * (no library). Places are map units; the drawing is shown with `xMidYMid meet`.
 */
afterEach(() => {
  setMediaQuery(REDUCED_MOTION, false);
  vi.useRealTimers();
});

const FIT: View = { x: 0, y: 0, width: 1000, height: 640 };
/** The SVG on screen: as wide as the map is in units, so one pixel is one unit at fit. */
const RECT = { left: 0, top: 0, width: 1000, height: 640 };

const near = (a: View, b: View) => {
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(a[k]).toBeCloseTo(b[k], 6);
};

describe('the math', () => {
  it('fits bounds with a margin on every side', () => {
    expect(fitView({ x: 100, y: 50, width: 40, height: 20 }, 4)).toEqual({
      x: 96,
      y: 46,
      width: 48,
      height: 28,
    });
  });

  it('zooms at a point and keeps that point where it was', () => {
    const at: [number, number] = [250, 160];
    const v = zoomAt(FIT, 2, at, FIT);
    expect(v.width).toBeCloseTo(500);
    expect(v.height).toBeCloseTo(320);
    // The point is as far across the new view as it was across the old one.
    expect((at[0] - v.x) / v.width).toBeCloseTo((at[0] - FIT.x) / FIT.width);
    expect((at[1] - v.y) / v.height).toBeCloseTo((at[1] - FIT.y) / FIT.height);
  });

  it('never zooms out past the fit, nor in past 40 times', () => {
    expect(MAX_ZOOM).toBe(40);
    near(zoomAt(FIT, 0.5, [500, 320], FIT), FIT);
    const deep = zoomAt(FIT, 1_000, [500, 320], FIT);
    expect(deep.width).toBeCloseTo(1000 / 40);
    expect(deep.height).toBeCloseTo(640 / 40);
  });

  it('pans by map units, keeping the view centered over the map', () => {
    const half = zoomAt(FIT, 2, [500, 320], FIT);
    near(panBy(half, 100, -50, FIT), { ...half, x: half.x + 100, y: half.y - 50 });
    // Not past the map's edge: the center stays on the map.
    const far = panBy(half, 10_000, 10_000, FIT);
    expect(far.x + far.width / 2).toBeCloseTo(1000);
    expect(far.y + far.height / 2).toBeCloseTo(640);
  });

  it('turns a point on screen into a map place, with the drawing centered (meet)', () => {
    expect(clientToMap(FIT, RECT, [500, 320])).toEqual([500, 320]);
    // A box twice as wide as the drawing: the drawing sits in its middle half.
    const wide = { left: 0, top: 0, width: 2560, height: 640 };
    expect(clientToMap(FIT, wide, [780, 0])).toEqual([0, 0]);
    expect(clientToMap(FIT, wide, [1780, 640])).toEqual([1000, 640]);
  });

  it('pinches: fingers twice as far apart zoom 2 times around their middle', () => {
    const v = pinchView(
      FIT,
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
    );
    expect(v.width).toBeCloseTo(500);
    // The middle (500, 300) stays under the fingers' middle.
    expect(clientToMap(v, RECT, [500, 300])[0]).toBeCloseTo(500);
    expect(clientToMap(v, RECT, [500, 300])[1]).toBeCloseTo(300);
  });
});

/** The hook, on an SVG of RECT's size. */
function mount() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.getBoundingClientRect = () => ({ ...RECT, x: 0, y: 0, right: 1000, bottom: 640 }) as DOMRect;
  document.body.append(svg);
  const hook = renderHook(() => usePanZoom(FIT));
  act(() => hook.result.current.ref(svg));
  return { ...hook, svg };
}
const pointer = (pointerId: number, clientX: number, clientY: number) =>
  ({ pointerId, clientX, clientY, button: 0, isPrimary: pointerId === 1 }) as React.PointerEvent;
const key = (k: string) => {
  const e = { key: k, preventDefault: vi.fn() };
  return e as unknown as React.KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
};

describe('usePanZoom', () => {
  it('starts at the fit, as a viewBox', () => {
    const { result } = mount();
    expect(result.current.viewBox).toBe('0 0 1000 640');
    expect(result.current.zoom).toBe(1);
  });

  it('pans by a drag, and says a drag happened so its click does not choose', () => {
    const { result } = mount();
    act(() => result.current.zoomIn());
    const before = result.current.view;
    act(() => result.current.onPointerDown(pointer(1, 500, 300)));
    act(() => result.current.onPointerMove(pointer(1, 450, 280)));
    act(() => result.current.onPointerUp(pointer(1, 450, 280)));
    const unitsPerPixel = before.width / 1000;
    expect(result.current.view.x).toBeCloseTo(before.x + 50 * unitsPerPixel);
    expect(result.current.view.y).toBeCloseTo(before.y + 20 * unitsPerPixel);
    expect(result.current.dragged()).toBe(true);
  });

  it('suppresses only the click that ends a drag, not a later click without a press (T060, M4)', () => {
    vi.useFakeTimers();
    try {
      const { result } = mount();
      act(() => result.current.onPointerDown(pointer(1, 500, 300)));
      act(() => result.current.onPointerMove(pointer(1, 450, 280)));
      act(() => result.current.onPointerUp(pointer(1, 450, 280)));
      // The click the browser sends with the pointerup, in the same task.
      expect(result.current.dragged()).toBe(true);
      // A later click with no pointerdown (a screen reader's activation) chooses.
      act(() => vi.runAllTimers());
      expect(result.current.dragged()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a press without a move is not a drag', () => {
    const { result } = mount();
    act(() => result.current.onPointerDown(pointer(1, 500, 300)));
    act(() => result.current.onPointerUp(pointer(1, 501, 300)));
    expect(result.current.dragged()).toBe(false);
  });

  it('zooms with two pointers pinching', () => {
    const { result } = mount();
    act(() => result.current.onPointerDown(pointer(1, 400, 300)));
    act(() => result.current.onPointerDown(pointer(2, 600, 300)));
    act(() => result.current.onPointerMove(pointer(1, 300, 300)));
    act(() => result.current.onPointerMove(pointer(2, 700, 300)));
    expect(result.current.zoom).toBeCloseTo(2);
  });

  it('zooms with the wheel at the pointer', () => {
    const { result, svg } = mount();
    act(() => {
      svg.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -500, clientX: 250, clientY: 160, cancelable: true }),
      );
    });
    expect(result.current.zoom).toBeGreaterThan(1);
    const v = result.current.view;
    expect((250 - v.x) / v.width).toBeCloseTo(0.25);
  });

  it('answers +, − and the arrow keys, and Fit', () => {
    const { result } = mount();
    const plus = key('+');
    act(() => result.current.onKeyDown(plus));
    expect(plus.preventDefault).toHaveBeenCalled();
    expect(result.current.zoom).toBeCloseTo(1.5);
    act(() => result.current.onKeyDown(key('+')));
    act(() => result.current.onKeyDown(key('-')));
    expect(result.current.zoom).toBeCloseTo(1.5);
    const before = result.current.view;
    act(() => result.current.onKeyDown(key('ArrowRight')));
    expect(result.current.view.x).toBeGreaterThan(before.x);
    act(() => result.current.onKeyDown(key('ArrowUp')));
    expect(result.current.view.y).toBeLessThan(before.y);
    act(() => result.current.onKeyDown(key('−')));
    act(() => result.current.fit());
    near(result.current.view, FIT);
    // Other keys are left alone (a seat's Enter, Tab).
    const tab = key('Tab');
    act(() => result.current.onKeyDown(tab));
    expect(tab.preventDefault).not.toHaveBeenCalled();
  });

  it('zooms to a section in 200 ms', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'setTimeout'] });
    const { result } = mount();
    act(() => result.current.zoomTo({ x: 100, y: 50, width: 40, height: 20 }));
    // Still on its way.
    expect(result.current.view.width).toBeGreaterThan(48);
    act(() => vi.advanceTimersByTime(250));
    // The section's bounds with a margin of a tenth of its larger side.
    near(result.current.view, { x: 96, y: 46, width: 48, height: 28 });
  });

  it('jumps straight there under reduced motion', () => {
    setMediaQuery(REDUCED_MOTION, true);
    const { result } = mount();
    act(() => result.current.zoomTo({ x: 100, y: 50, width: 40, height: 20 }));
    near(result.current.view, { x: 96, y: 46, width: 48, height: 28 });
  });
});
