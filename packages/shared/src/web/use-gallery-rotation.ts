import { useCallback, useEffect, useState } from 'react';
import { GALLERY_INTERVAL_MS } from '../event-image.js';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether the device asks for reduced motion, following changes to the setting. */
function useReducedMotion(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [reduced, setReduced] = useState(
    () => supported && window.matchMedia(REDUCED_MOTION).matches,
  );
  useEffect(() => {
    if (!supported) return;
    const list = window.matchMedia(REDUCED_MOTION);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    setReduced(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [supported]);
  return reduced;
}

/** Which way the last change slides: `left` for the next image, `right` for the previous. */
export type SlideDirection = 'left' | 'right';

export interface GalleryRotation {
  /** The shown image, 0-based. */
  index: number;
  /** Counts the changes, so a change is seen even when it lands on an index shown before. */
  turn: number;
  /** The direction of the last change, from the action rather than the index (FR-040). */
  direction: SlideDirection;
  next(): void;
  prev(): void;
  /** Shows image `index` at once, as a jump rather than a change: no slide (the viewer closing). */
  show(index: number): void;
  /** No automatic change and no Pause/Play button (FR-025). */
  reducedMotion: boolean;
  /** The gallery is changing on its own right now. */
  rotating: boolean;
}

/**
 * Spec 014 FR-022 to FR-025, FR-038 (research R11). With 2 or more images, the next image every
 * 5,000 ms, the first after the last. Every change, automatic or by an arrow, waits a fresh
 * 5,000 ms. No timer while `paused` (an arrow under the pointer or with keyboard focus, and the
 * like), while `stopped` (the Pause/Play button), or under reduced motion; the arrows still work.
 */
export function useGalleryRotation({
  count,
  paused = false,
  stopped = false,
  start = 0,
}: {
  count: number;
  paused?: boolean;
  stopped?: boolean;
  /** The image shown first, 0-based (the full-screen view opens on the gallery's image). */
  start?: number;
}): GalleryRotation {
  // `turn` is bumped on every change, so the wait restarts even when the index lands where it was.
  const [state, setState] = useState<{ index: number; turn: number; direction: SlideDirection }>({
    index: start,
    turn: 0,
    direction: 'left',
  });
  const { index, turn, direction } = state;
  const reducedMotion = useReducedMotion();
  const rotating = count >= 2 && !paused && !stopped && !reducedMotion;

  const step = useCallback(
    (by: number) => {
      if (count < 2) return;
      setState((now) => ({
        index: (((now.index + by) % count) + count) % count,
        turn: now.turn + 1,
        // Research R11: wrapping from the last image to the first still slides left.
        direction: by > 0 ? 'left' : 'right',
      }));
    },
    [count],
  );

  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => step(1), GALLERY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [rotating, turn, step]);

  return {
    index: count > 0 ? Math.min(index, count - 1) : 0,
    turn,
    direction,
    next: useCallback(() => step(1), [step]),
    prev: useCallback(() => step(-1), [step]),
    show: useCallback((at: number) => setState((now) => ({ ...now, index: at })), []),
    reducedMotion,
    rotating,
  };
}
