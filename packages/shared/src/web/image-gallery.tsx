import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { EventImage } from '../event-image.js';
import { useEventImage } from './event-images.js';
import { useGalleryRotation, type SlideDirection } from './use-gallery-rotation.js';

/** The slide between images: the length of the theme's `gallery-*` keyframes (FR-040). */
export const SLIDE_MS = 400;

/** Research R14: how near the screen a card's gallery counts as on it. */
const NEAR_SCREEN = '200px';

export interface ImageGalleryProps {
  eventId: string;
  eventName: string;
  /** The event's images in order; none renders nothing (FR-027). */
  images: EventImage[];
  /**
   * `page`: across the top of the event page, with a full-screen button. `card`: at the top of an
   * Events list card, its image a link to the event, loaded only on or near the screen (research
   * R12, R14).
   */
  variant: 'card' | 'page';
  /** `card`: where the image leads, the same place as the card's title link (FR-020). */
  eventHref?: string;
  /** `page`: opens the shown image full screen (US5 connects it). */
  onOpen?: (index: number) => void;
}

/** Keeps one image loaded while mounted; renders nothing (research R4). */
function Held({ eventId, imageId }: { eventId: string; imageId: string }) {
  useEventImage(eventId, imageId);
  return null;
}

/** The shown image, or a placeholder of the same size while it loads or when it failed. */
function Slide({
  eventId,
  image,
  alt,
  enabled = true,
}: {
  eventId: string;
  image: EventImage;
  alt: string;
  enabled?: boolean;
}) {
  const { url, failed } = useEventImage(eventId, image.id, enabled);
  if (url) return <img className="gallery__image" src={url} alt={alt} />;
  return <span className="gallery__placeholder">{failed ? 'Image unavailable' : null}</span>;
}

/**
 * Research R14: whether the element in `ref` is on or near the screen, for a gallery that
 * `watch`es. Without `IntersectionObserver` (jsdom) it counts as on screen.
 */
function useOnScreen(ref: RefObject<HTMLElement | null>, watch: boolean): boolean {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!watch || !supported || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.target === el) setOnScreen(entry.isIntersecting);
      },
      { rootMargin: NEAR_SCREEN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, watch, supported]);
  return !watch || !supported || onScreen;
}

interface SlideState {
  /** The outgoing image's index. */
  from: number;
  direction: SlideDirection;
}

/**
 * Spec 014 FR-040 (research R11): after each change, the image shown before slides out while the
 * new one slides in, for `SLIDE_MS` or until the outgoing animation ends. A change during a slide
 * drops the outgoing image and slides from the current one. `still` (reduced motion, or a card off
 * screen) means no slide at all.
 */
function useSlide(
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
  } else if (still && slide) {
    setSlide(null);
  }
  useEffect(() => {
    if (!slide) return;
    const timer = setTimeout(() => setSlide(null), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [slide]);
  return [slide, () => setSlide(null)];
}

/**
 * Spec 014 US2 and US4 (FR-020 to FR-028, FR-031, FR-032, FR-038 to FR-040; research R10 to R14):
 * an event's images as a gallery that shows the next image every 5 seconds, sliding between them,
 * with previous and next arrows, the position in words, and a Pause/Play button. It also pauses
 * while the pointer is over an arrow, while an arrow or the full-screen image button has keyboard
 * focus, and, on a card, while the card is off screen; nothing else pauses it.
 */
export function ImageGallery({
  eventId,
  eventName,
  images,
  variant,
  eventHref,
  onOpen,
}: ImageGalleryProps) {
  const count = images.length;
  const card = variant === 'card';
  const root = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(root, card && count > 0);
  const [stopped, setStopped] = useState(false);
  const [overArrow, setOverArrow] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  // Research R11: a pointer press is followed by focus; that focus is not keyboard focus.
  const pointerDown = useRef(false);
  const rotation = useGalleryRotation({
    count,
    paused: overArrow || keyboardFocus || !onScreen,
    stopped,
  });
  const { index } = rotation;
  const [slide, endSlide] = useSlide(
    index,
    rotation.turn,
    rotation.direction,
    rotation.reducedMotion || !onScreen,
  );

  // Research R14: the event page loads the shown image and the next one, and holds each image it
  // has loaded until it unmounts, so looping back neither fetches again nor flickers.
  const [wanted, setWanted] = useState<Set<number>>(() => new Set([0, 1]));
  useEffect(() => {
    if (count === 0 || card) return;
    setWanted((now) =>
      now.has(index) && now.has((index + 1) % count)
        ? now
        : new Set([...now, index, (index + 1) % count]),
    );
  }, [index, count, card]);

  if (count === 0) return null;

  const shown = images[index]!;
  const leaving = slide && slide.from < count ? images[slide.from]! : null;
  // FR-032, FR-039 (research R14): a card holds only the shown and the next image, plus the
  // outgoing one during a slide (FR-040), and nothing while off screen.
  const held: Set<number> = !card
    ? wanted
    : onScreen
      ? new Set([index, (index + 1) % count, ...(slide && leaving ? [slide.from] : [])])
      : new Set();
  const position = `image ${index + 1} of ${count}`;
  const several = count >= 2;

  const keyboardOnly = {
    onFocus: () => {
      if (!pointerDown.current) setKeyboardFocus(true);
    },
    onBlur: () => setKeyboardFocus(false),
  };
  const arrowProps = {
    ...keyboardOnly,
    onPointerEnter: () => setOverArrow(true),
    onPointerLeave: () => setOverArrow(false),
  };

  const incoming = (
    <span
      key={shown.id}
      className={
        slide && leaving ? `gallery__frame gallery__slide--in-${slide.direction}` : 'gallery__frame'
      }
    >
      <Slide eventId={eventId} image={shown} alt={`${eventName}, ${position}`} enabled={onScreen} />
    </span>
  );

  return (
    <div
      ref={root}
      role="group"
      aria-roledescription="carousel"
      aria-label={`Images of ${eventName}`}
      className={`gallery gallery--${variant}`}
      onPointerDown={() => {
        pointerDown.current = true;
        setKeyboardFocus(false);
      }}
      onPointerUp={() => {
        pointerDown.current = false;
      }}
    >
      {images.map((image, i) =>
        held.has(i) ? <Held key={image.id} eventId={eventId} imageId={image.id} /> : null,
      )}
      <div className="gallery__slide" aria-live={rotation.rotating ? 'off' : 'polite'}>
        {slide && leaving && (
          // FR-040: the image shown before, on its way out; not a control and not announced.
          <div
            key={`out-${leaving.id}`}
            className={`gallery__frame gallery__slide--out-${slide.direction}`}
            aria-hidden="true"
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) endSlide();
            }}
          >
            <Slide eventId={eventId} image={leaving} alt="" />
          </div>
        )}
        {card ? (
          // Research R12: the same destination as the card's title link, so it is neither a second
          // tab stop nor announced twice, only a larger target for the pointer.
          <Link to={eventHref ?? ''} className="gallery__open" tabIndex={-1} aria-hidden="true">
            {incoming}
          </Link>
        ) : (
          <button
            type="button"
            className="gallery__open"
            aria-label={`View ${eventName}, ${position}, full screen`}
            onClick={() => onOpen?.(index)}
            {...keyboardOnly}
          >
            {incoming}
          </button>
        )}
      </div>
      {several && (
        <>
          <button
            type="button"
            className="gallery__arrow gallery__arrow--prev"
            aria-label={`Previous image of ${eventName}`}
            onClick={rotation.prev}
            {...arrowProps}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="gallery__arrow gallery__arrow--next"
            aria-label={`Next image of ${eventName}`}
            onClick={rotation.next}
            {...arrowProps}
          >
            <span aria-hidden="true">›</span>
          </button>
          {!rotation.reducedMotion && (
            <button
              type="button"
              className="gallery__toggle"
              aria-label={`${stopped ? 'Play' : 'Pause'} images of ${eventName}`}
              onClick={() => setStopped((s) => !s)}
            >
              <span aria-hidden="true">{stopped ? '▶' : '❚❚'}</span>
            </button>
          )}
          <p className="gallery__count">{`${index + 1} of ${count}`}</p>
        </>
      )}
    </div>
  );
}
