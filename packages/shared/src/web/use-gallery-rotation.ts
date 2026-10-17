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

export interface GalleryRotation {
  /** The shown image, 0-based. */
  index: number;
  next(): void;
  prev(): void;
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
}: {
  count: number;
  paused?: boolean;
  stopped?: boolean;
}): GalleryRotation {
  const [index, setIndex] = useState(0);
  // Bumped on every change, so the wait restarts even when the index lands where it was.
  const [turn, setTurn] = useState(0);
  const reducedMotion = useReducedMotion();
  const rotating = count >= 2 && !paused && !stopped && !reducedMotion;

  const step = useCallback(
    (by: number) => {
      if (count < 2) return;
      setIndex((i) => (((i + by) % count) + count) % count);
      setTurn((t) => t + 1);
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
    next: useCallback(() => step(1), [step]),
    prev: useCallback(() => step(-1), [step]),
    reducedMotion,
    rotating,
  };
}
