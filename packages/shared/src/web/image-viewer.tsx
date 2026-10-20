import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { EventImage } from '../event-image.js';
import {
  EventPicture,
  HeldImages,
  SHOWN_AND_NEIGHBORS,
  useSlide,
  useWantedImages,
} from './gallery-parts.js';
import { useGalleryRotation } from './use-gallery-rotation.js';

export interface ImageViewerProps {
  eventId: string;
  eventName: string;
  /** The event's images in order. */
  images: EventImage[];
  /** The image to open on, 0-based. */
  start: number;
  /**
   * Closes the view; `index` is the image last viewed, which the gallery then shows (FR-030).
   * `byKeyboard` says whether a key closed it (Esc, or Enter or Space on the close button), so the
   * gallery counts the focus it gets back as keyboard focus only then (research R11).
   */
  onClose: (index: number, how: { byKeyboard: boolean }) => void;
}

/**
 * Spec 014 US5 (FR-029, FR-030, FR-040; research R12): an event's image full screen, over the
 * whole window on a dark backdrop, the whole picture as large as fits. Previous and next buttons
 * and the left and right arrow keys flip, sliding as the galleries do; it never changes on its
 * own. Esc and the close button close it. While open, focus stays among its buttons, the app root
 * is inert, and the page behind does not scroll.
 */
export function ImageViewer({ eventId, eventName, images, start, onClose }: ImageViewerProps) {
  const count = images.length;
  // Stopped for good: the view changes only when asked (FR-029).
  const rotation = useGalleryRotation({ count, stopped: true, start });
  const { index } = rotation;
  const [slide, endSlide] = useSlide(
    index,
    rotation.turn,
    rotation.direction,
    rotation.reducedMotion,
  );
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  // Research R4, R14: the shown image and its neighbors, each held until the view closes.
  const wanted = useWantedImages(index, count, SHOWN_AND_NEIGHBORS);

  // Research R12: the app behind is inert and does not scroll; focus starts on Close.
  useEffect(() => {
    const root = document.getElementById('root');
    const wasInert = root?.hasAttribute('inert') ?? false;
    root?.setAttribute('inert', '');
    document.body.classList.add('viewer-open');
    close.current?.focus();
    return () => {
      if (!wasInert) root?.removeAttribute('inert');
      document.body.classList.remove('viewer-open');
    };
  }, []);

  if (count === 0) return null;
  const shown = images[index]!;
  const leaving = slide && slide.from < count ? images[slide.from]! : null;
  const label = `${eventName}, image ${index + 1} of ${count}`;
  const several = count >= 2;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose(index, { byKeyboard: true });
    } else if (e.key === 'ArrowRight' && several) {
      e.preventDefault();
      rotation.next();
    } else if (e.key === 'ArrowLeft' && several) {
      e.preventDefault();
      rotation.prev();
    } else if (e.key === 'Tab') {
      // FR-030: Tab and Shift+Tab cycle among the view's own buttons (jsdom has no `inert`).
      const buttons = [...(dialog.current?.querySelectorAll('button') ?? [])];
      if (buttons.length === 0) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const to = e.shiftKey
        ? at <= 0
          ? buttons.length - 1
          : at - 1
        : at < 0 || at === buttons.length - 1
          ? 0
          : at + 1;
      e.preventDefault();
      buttons[to]!.focus();
    }
  }

  return createPortal(
    <div
      ref={dialog}
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      // FR-029: a click on the picture or the backdrop focuses the dialog, not the page, so Esc
      // and the arrow keys still reach it.
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <HeldImages eventId={eventId} images={images} held={wanted} />
      <div className="viewer__stage">
        {slide && leaving && (
          // FR-040: the image shown before, on its way out; not announced.
          <div
            key={`out-${leaving.id}`}
            className={`viewer__frame gallery__slide--out-${slide.direction}`}
            aria-hidden="true"
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) endSlide();
            }}
          >
            <EventPicture eventId={eventId} image={leaving} alt="" part="viewer" />
          </div>
        )}
        <div
          key={shown.id}
          className={
            slide && leaving
              ? `viewer__frame gallery__slide--in-${slide.direction}`
              : 'viewer__frame'
          }
        >
          <EventPicture eventId={eventId} image={shown} alt={label} part="viewer" />
        </div>
      </div>
      <button
        ref={close}
        type="button"
        className="viewer__close"
        aria-label="Close full screen"
        // A click from a key press has no pointer clicks counted (`detail` 0).
        onClick={(e) => onClose(index, { byKeyboard: e.detail === 0 })}
      >
        <span aria-hidden="true">×</span>
      </button>
      {several && (
        <>
          <button
            type="button"
            className="viewer__arrow viewer__arrow--prev"
            aria-label="Previous image"
            onClick={rotation.prev}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="viewer__arrow viewer__arrow--next"
            aria-label="Next image"
            onClick={rotation.next}
          >
            <span aria-hidden="true">›</span>
          </button>
          <p className="viewer__count" aria-live="polite">{`${index + 1} of ${count}`}</p>
        </>
      )}
    </div>,
    document.body,
  );
}
