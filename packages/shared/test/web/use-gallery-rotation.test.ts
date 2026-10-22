import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGalleryRotation } from '../../src/web/use-gallery-rotation';
import { REDUCED_MOTION, setMediaQuery } from './browser-stubs';

/** Spec 014 FR-022 to FR-025, FR-038; research R11: the 5-second rotation and its pauses. */
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

type Props = { count: number; paused?: boolean; stopped?: boolean };
const setup = (props: Props) =>
  renderHook((p: Props) => useGalleryRotation(p), { initialProps: props });

describe('useGalleryRotation', () => {
  it('moves on every 5,000 ms (not at 4,999) and wraps', () => {
    const { result } = setup({ count: 3 });
    expect(result.current.index).toBe(0);
    tick(4999);
    expect(result.current.index).toBe(0);
    tick(1);
    expect(result.current.index).toBe(1);
    tick(5000);
    expect(result.current.index).toBe(2);
    tick(5000);
    expect(result.current.index).toBe(0);
  });

  it('shows the next at once on next(), and waits a full 5,000 ms after the press', () => {
    const { result } = setup({ count: 3 });
    tick(3000);
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    tick(4999);
    expect(result.current.index).toBe(1);
    tick(1);
    expect(result.current.index).toBe(2);
  });

  it('goes from the first to the last on prev()', () => {
    const { result } = setup({ count: 3 });
    act(() => result.current.prev());
    expect(result.current.index).toBe(2);
  });

  it('does not move while paused, and moves 5,000 ms after the pause ends', () => {
    const { result, rerender } = setup({ count: 3 });
    tick(2000);
    rerender({ count: 3, paused: true });
    tick(20_000);
    expect(result.current.index).toBe(0);
    rerender({ count: 3, paused: false });
    tick(4999);
    expect(result.current.index).toBe(0);
    tick(1);
    expect(result.current.index).toBe(1);
  });

  it('runs no timer under reduced motion, still flips, and starts when the preference is off', () => {
    setMediaQuery(REDUCED_MOTION, true);
    const { result } = setup({ count: 3 });
    expect(result.current.reducedMotion).toBe(true);
    tick(20_000);
    expect(result.current.index).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    act(() => setMediaQuery(REDUCED_MOTION, false));
    expect(result.current.reducedMotion).toBe(false);
    tick(5000);
    expect(result.current.index).toBe(2);
  });

  it.each([0, 1])('sets no timer with %i images', (count) => {
    const { result } = setup({ count });
    expect(vi.getTimerCount()).toBe(0);
    tick(20_000);
    expect(result.current.index).toBe(0);
  });

  it('does not move while stopped, whatever paused does; arrows flip without a timer', () => {
    const { result, rerender } = setup({ count: 3, stopped: true });
    tick(10_000);
    rerender({ count: 3, stopped: true, paused: true });
    tick(5000);
    rerender({ count: 3, stopped: true, paused: false });
    tick(5000);
    expect(result.current.index).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    act(() => result.current.prev());
    act(() => result.current.prev());
    expect(result.current.index).toBe(2);
    expect(vi.getTimerCount()).toBe(0);

    rerender({ count: 3, stopped: false });
    tick(4999);
    expect(result.current.index).toBe(2);
    tick(1);
    expect(result.current.index).toBe(0);
  });
});
