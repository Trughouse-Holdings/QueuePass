import { useEffect, useState } from 'react';
import type { EventImage } from '../event-image.js';
import { useEventImage } from './event-images.js';
import type { SlideDirection } from './use-gallery-rotation.js';

/**
 * Spec 014: the pieces the galleries (`image-gallery.tsx`) and the full-screen view
 * (`image-viewer.tsx`) share, in one module so neither imports the other's (review of PR #63).
 */

/** The slide between images: the length of the theme's `gallery-*` keyframes (FR-040). */
export const SLIDE_MS = 400;

/** Keeps one image loaded while mounted; renders nothing (research R4). */
function Held({ eventId, imageId }: { eventId: string; imageId: string }) {
  useEventImage(eventId, imageId);
  return null;
}

/** Keeps the images at the indexes in `held` loaded while mounted; renders nothing (R4, R14). */
export function HeldImages({
  eventId,
  images,
  held,
}: {
  eventId: string;
  images: EventImage[];
  held: ReadonlySet<number>;
}) {
  return (
    <>
      {images.map((image, i) =>
        held.has(i) ? <Held key={image.id} eventId={eventId} imageId={image.id} /> : null,
      )}
    </>
  );
}

/**
 * The image, or a placeholder of the same size while it loads or when it failed (FR-031), with
 * the classes of `part`: `gallery__image` or `viewer__image`, and the matching placeholder.
 * `onShape` hears the picture's width / height once the browser has read it (FR-042, R18).
 */
export function EventPicture({
  eventId,
  image,
  alt,
  part,
  enabled = true,
  onShape,
}: {
  eventId: string;
  image: EventImage;
  alt: string;
  part: 'gallery' | 'viewer';
  enabled?: boolean;
  onShape?: (ratio: number) => void;
}) {
  const { url, failed } = useEventImage(eventId, image.id, enabled);
  if (url)
    return (
      <img
        className={`${part}__image`}
        src={url}
        alt={alt}
        onLoad={
          onShape &&
          ((e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w > 0 && h > 0) onShape(w / h);
          })
        }
      />
    );
  return <span className={`${part}__placeholder`}>{failed ? 'Image unavailable' : null}</span>;
}

/** Offsets from the shown image: the event-page gallery wants it and the next one. */
export const SHOWN_AND_NEXT: readonly number[] = [0, 1];
/** Offsets from the shown image: the full-screen view wants it and both neighbors. */
export const SHOWN_AND_NEIGHBORS: readonly number[] = [0, 1, -1];

/**
 * Research R4, R14: the indexes of every image wanted so far, growing as `index` moves (each at
 * `offsets` from it, wrapping around) and never shrinking, so a gallery or view that holds them
 * until it unmounts neither fetches again nor flickers when it loops back. `initial` is wanted
 * from the first render; nothing is added while not `active`.
 */
export function useWantedImages(
  index: number,
  count: number,
  offsets: readonly number[],
  { active = true, initial = [] }: { active?: boolean; initial?: readonly number[] } = {},
): ReadonlySet<number> {
  const [wanted, setWanted] = useState<ReadonlySet<number>>(() => new Set(initial));
  useEffect(() => {
    if (!active || count === 0) return;
    const around = offsets.map((o) => (((index + o) % count) + count) % count);
    setWanted((now) => (around.every((i) => now.has(i)) ? now : new Set([...now, ...around])));
  }, [index, count, offsets, active]);
  return wanted;
}

export interface SlideState {
  /** The outgoing image's index. */
  from: number;
  direction: SlideDirection;
}

/**
 * Spec 014 FR-040 (research R11): after each change, the image shown before slides out while the
 * new one slides in, for `SLIDE_MS` or until the outgoing animation ends. A change during a slide
 * drops the outgoing image and slides from the current one. `still` (reduced motion, or a card off
 * screen) means no slide at all. A new index with no new `turn` is a jump (the gallery showing the
 * image last viewed full screen), with no slide. The galleries and the full-screen view share it.
 */
export function useSlide(
  index: number,
  turn: number,
  direction: SlideDirection,
  still: boolean,
): [SlideState | null, () => void] {
  const [seen, setSeen] = useState({ turn, index });
  const [slide, setSlide] = useState<SlideState | null>(null);
  // Set during render (React's derived-state pattern), so the outgoing image is in the very first
  // frame of the change and the incoming one never shows alone first.
  if (seen.turn !== turn) {
    setSeen({ turn, index });
    setSlide(still ? null : { from: seen.index, direction });
  } else {
    if (seen.index !== index) setSeen({ turn, index });
    if (still && slide) setSlide(null);
  }
  useEffect(() => {
    if (!slide) return;
    const timer = setTimeout(() => setSlide(null), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [slide]);
  return [slide, () => setSlide(null)];
}
