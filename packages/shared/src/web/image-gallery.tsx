import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { EventImage } from '../event-image.js';
import {
  EventPicture,
  HeldImages,
  SHOWN_AND_NEXT,
  useSlide,
  useWantedImages,
} from './gallery-parts.js';
import { ImageViewer } from './image-viewer.js';
import { useGalleryRotation } from './use-gallery-rotation.js';

/** Research R14: how near the screen a card's gallery counts as on it. */
const NEAR_SCREEN = '200px';

export interface ImageGalleryProps {
  eventId: string;
  eventName: string;
  /** The event's images in order; none renders nothing (FR-027). */
  images: EventImage[];
  /**
   * `page`: across the top of the event page, its image a button that opens it full screen
   * (`ImageViewer`). `card`: at the top of an
   * Events list card, its image a link to the event, loaded only on or near the screen (research
   * R12, R14).
   */
  variant: 'card' | 'page';
  /** `card`: where the image leads, the same place as the card's title link (FR-020). */
  eventHref?: string;
}

/**
 * Research R14: one IntersectionObserver for every gallery that watches, each told only about its
 * own element (review of PR #63: an Events list of 50 cards needs one observer, not 50).
 */
const nearScreen = new Map<Element, (on: boolean) => void>();
let observer: IntersectionObserver | null = null;

function watchNearScreen(el: Element, onChange: (on: boolean) => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) nearScreen.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: NEAR_SCREEN },
  );
  nearScreen.set(el, onChange);
  observer.observe(el);
  return () => {
    nearScreen.delete(el);
    observer?.unobserve(el);
    if (nearScreen.size > 0) return;
    observer?.disconnect();
    observer = null;
  };
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
    return watchNearScreen(el, setOnScreen);
  }, [ref, watch, supported]);
  return !watch || !supported || onScreen;
}

/**
 * Research R11: a pointer press is followed by focus, and that focus is not keyboard focus. The
 * focus a press gives comes before its pointerup with a mouse, but after it with touch (from the
 * compatibility mousedown), so the press ends at the click that follows, anywhere in the document.
 * A press with no click ends at pointercancel (a native drag or a scroll), or at the next key,
 * since keyboard focus always follows a key. One set of capture listeners on the document ends the
 * presses of every gallery (review of PR #63), added with the first gallery and removed with the
 * last.
 */
const presses = new Set<{ current: boolean }>();
const PRESS_ENDS = ['click', 'pointercancel', 'keydown'] as const;

function endPresses(): void {
  for (const press of presses) press.current = false;
}

/** This gallery's press: set on its own pointerdown, ended by the shared listeners. */
function usePointerPress(): { current: boolean } {
  const pressed = useRef(false);
  useEffect(() => {
    if (presses.size === 0)
      for (const type of PRESS_ENDS) document.addEventListener(type, endPresses, true);
    presses.add(pressed);
    return () => {
      presses.delete(pressed);
      if (presses.size === 0)
        for (const type of PRESS_ENDS) document.removeEventListener(type, endPresses, true);
    };
  }, []);
  return pressed;
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
}: ImageGalleryProps) {
  const count = images.length;
  const card = variant === 'card';
  const root = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(root, card && count > 0);
  const [stopped, setStopped] = useState(false);
  const [overArrow, setOverArrow] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  // US5: the image open full screen, if any; the gallery does not turn meanwhile (research R11).
  const [viewing, setViewing] = useState<number | null>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const wasViewing = useRef(false);
  // Research R11: a pointer press is followed by focus; that focus is not keyboard focus.
  const pointerDown = usePointerPress();
  // Research R11: focus given back by a full-screen view a pointer closed is not keyboard focus.
  const closedByPointer = useRef(false);
  const rotation = useGalleryRotation({
    count,
    paused: overArrow || keyboardFocus || !onScreen || viewing !== null,
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
  const wanted = useWantedImages(index, count, SHOWN_AND_NEXT, { active: !card, initial: [0, 1] });

  // FR-030: on closing full screen, focus goes back to the image button that opened it, once the
  // view has made the app usable again.
  useEffect(() => {
    if (viewing !== null) {
      wasViewing.current = true;
    } else if (wasViewing.current) {
      wasViewing.current = false;
      openButton.current?.focus();
      closedByPointer.current = false;
    }
  }, [viewing]);

  if (count === 0) return null;

  const shown = images[index]!;
  const leaving = slide && slide.from < count ? images[slide.from]! : null;
  // FR-032, FR-039 (research R14): a card holds only the shown and the next image, plus the
  // outgoing one during a slide (FR-040), and nothing while off screen.
  const held: ReadonlySet<number> = !card
    ? wanted
    : onScreen
      ? new Set([index, (index + 1) % count, ...(slide && leaving ? [slide.from] : [])])
      : new Set();
  const position = `image ${index + 1} of ${count}`;
  const several = count >= 2;

  const keyboardOnly = {
    onFocus: () => {
      if (!pointerDown.current && !closedByPointer.current) setKeyboardFocus(true);
    },
    onBlur: () => setKeyboardFocus(false),
  };
  const arrowProps = {
    ...keyboardOnly,
    onPointerEnter: () => setOverArrow(true),
    onPointerLeave: () => setOverArrow(false),
  };

  const positionText = several ? (
    <p className="gallery__count">{`${index + 1} of ${count}`}</p>
  ) : null;

  const incoming = (
    <span
      key={shown.id}
      className={
        slide && leaving ? `gallery__frame gallery__slide--in-${slide.direction}` : 'gallery__frame'
      }
    >
      <EventPicture
        eventId={eventId}
        image={shown}
        alt={`${eventName}, ${position}`}
        part="gallery"
        enabled={onScreen}
      />
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
    >
      <HeldImages eventId={eventId} images={images} held={held} />
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
            <EventPicture eventId={eventId} image={leaving} alt="" part="gallery" />
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
            ref={openButton}
            type="button"
            className="gallery__open"
            aria-label={`View ${eventName}, ${position}, full screen`}
            onClick={() => setViewing(index)}
            {...keyboardOnly}
          >
            {incoming}
          </button>
        )}
        {/* FR-028 (research R11): on a card the image sits in the hidden link, so the position is
            what the live region announces. */}
        {card && positionText}
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
          {!card && positionText}
        </>
      )}
      {viewing !== null && (
        <ImageViewer
          eventId={eventId}
          eventName={eventName}
          images={images}
          start={viewing}
          onClose={(last, { byKeyboard }) => {
            closedByPointer.current = !byKeyboard;
            rotation.show(last);
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}
