import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageGallery } from '../../src/web/image-gallery';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EventImage } from '../../src/event-image';
import {
  installIntersectionObserver,
  objectUrls,
  REDUCED_MOTION,
  setMediaQuery,
} from './browser-stubs';
import {
  advance,
  EVENT_ID,
  imageResponse,
  images,
  renderSignedIn,
  stubImages,
} from './image-helpers';

/**
 * Spec 014 US2 (FR-021 to FR-028, FR-031, FR-038; research R10 to R13): the event page gallery.
 */
beforeEach(() => {
  vi.useFakeTimers();
  // Testing Library drains its async helpers with a setTimeout, advanced only for Jest's fake
  // timers; this lets user-event run under Vitest's.
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const NAME = 'Season Opener';

async function show(count: number, extra?: React.ReactNode) {
  const view = renderSignedIn(
    <>
      <div className="page-band">
        <ImageGallery eventId={EVENT_ID} eventName={NAME} images={images(count)} variant="page" />
      </div>
      {extra}
    </>,
  );
  await advance(0);
  return view;
}

const keyboard = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
const position = () => screen.getByText(/^\d of \d$/).textContent;
const shownAlt = () => screen.getByRole('img').getAttribute('alt');
const arrow = (which: 'Previous' | 'Next') =>
  screen.getByRole('button', { name: `${which} image of ${NAME}` });
const toggle = () => screen.getByRole('button', { name: /^(Pause|Play) images of Season Opener$/ });
const openButton = () => screen.getByRole('button', { name: /^View Season Opener, image/ });

describe('ImageGallery, page variant', () => {
  it('renders nothing for no images', async () => {
    stubImages();
    const { container } = await show(0);
    expect(container.querySelector('.page-band')).toBeEmptyDOMElement();
  });

  it('shows one image with no arrows, no position, no Pause/Play, and no timer', async () => {
    stubImages();
    await show(1);
    expect(screen.getByRole('img', { name: `${NAME}, image 1 of 1` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /image of Season Opener$/ })).toBeNull();
    expect(screen.queryByText(/of 1$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /images of Season Opener/ })).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('labels the carousel, its image, its position, its arrows, and its full-screen button', async () => {
    stubImages();
    const { container } = await show(3);
    const group = screen.getByRole('group', { name: `Images of ${NAME}` });
    expect(group).toHaveAttribute('aria-roledescription', 'carousel');
    expect(group.closest('.page-band')).toBe(container.querySelector('.page-band'));
    expect(screen.getByRole('img', { name: `${NAME}, image 1 of 3` })).toBeInTheDocument();
    expect(position()).toBe('1 of 3');
    expect(arrow('Previous')).toHaveClass('gallery__arrow');
    expect(arrow('Next')).toHaveClass('gallery__arrow');
    expect(
      within(
        screen.getByRole('button', { name: `View ${NAME}, image 1 of 3, full screen` }),
      ).getByRole('img'),
    ).toBeInTheDocument();
  });

  it('shows image 2 after 5 seconds', async () => {
    stubImages();
    await show(3);
    await advance(5000);
    expect(shownAlt()).toBe(`${NAME}, image 2 of 3`);
    expect(position()).toBe('2 of 3');
  });

  describe('the Pause/Play button (FR-038)', () => {
    it('stops the turning until Play, keeps focus, and lets the arrows flip', async () => {
      stubImages();
      await show(3);
      const user = keyboard();
      expect(toggle()).toHaveAccessibleName(`Pause images of ${NAME}`);
      expect(toggle()).toHaveClass('gallery__toggle');
      await user.click(toggle());
      await advance(30_000);
      expect(position()).toBe('1 of 3');
      expect(toggle()).toHaveAccessibleName(`Play images of ${NAME}`);
      expect(toggle()).toHaveFocus();

      await user.click(arrow('Next'));
      await advance(0);
      expect(position()).toBe('2 of 3');
      fireEvent.pointerLeave(arrow('Next'));
      act(() => arrow('Next').blur());
      await advance(20_000);
      expect(position()).toBe('2 of 3');

      await user.click(toggle());
      expect(toggle()).toHaveAccessibleName(`Pause images of ${NAME}`);
      fireEvent.pointerLeave(toggle());
      await advance(4999);
      expect(position()).toBe('2 of 3');
      await advance(1);
      expect(position()).toBe('3 of 3');
    });

    it('does not pause when only the Pause/Play button has keyboard focus', async () => {
      stubImages();
      await show(3);
      act(() => toggle().focus());
      await advance(5000);
      expect(position()).toBe('2 of 3');
    });

    it('is not there under reduced motion', async () => {
      setMediaQuery(REDUCED_MOTION, true);
      stubImages();
      await show(3);
      expect(screen.queryByRole('button', { name: /images of Season Opener$/ })).toBeNull();
      await advance(20_000);
      expect(position()).toBe('1 of 3');
    });

    it('is not remembered: mounted again, the gallery turns', async () => {
      stubImages();
      const first = await show(3);
      const user = keyboard();
      await user.click(toggle());
      first.unmount();
      await show(3);
      expect(toggle()).toHaveAccessibleName(`Pause images of ${NAME}`);
      await advance(5000);
      expect(position()).toBe('2 of 3');
    });
  });

  it('keeps turning with the pointer over the image, and pauses with it over an arrow', async () => {
    stubImages();
    await show(3);
    fireEvent.pointerEnter(screen.getByRole('img'));
    await advance(5000);
    expect(position()).toBe('2 of 3');
    await advance(5000);
    expect(position()).toBe('3 of 3');
    await advance(5000);
    expect(position()).toBe('1 of 3');

    fireEvent.pointerEnter(arrow('Next'));
    await advance(15_000);
    expect(position()).toBe('1 of 3');
    fireEvent.pointerLeave(arrow('Next'));
    await advance(4999);
    expect(position()).toBe('1 of 3');
    await advance(1);
    expect(position()).toBe('2 of 3');
  });

  it('pauses while an arrow has keyboard focus, not after a pointer click', async () => {
    stubImages();
    await show(3, <button type="button">Outside</button>);
    const user = keyboard();
    await user.tab(); // the full-screen image button
    await user.tab(); // Previous
    expect(arrow('Previous')).toHaveFocus();
    await advance(15_000);
    expect(position()).toBe('1 of 3');
    await user.tab(); // Next
    await user.tab(); // Pause/Play
    await user.tab(); // out of the gallery
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    await advance(4999);
    expect(position()).toBe('1 of 3');
    await advance(1);
    expect(position()).toBe('2 of 3');

    await user.click(arrow('Next'));
    expect(position()).toBe('3 of 3');
    fireEvent.pointerLeave(arrow('Next'));
    await advance(5000);
    expect(position()).toBe('1 of 3');
  });

  it('pauses while the full-screen image button has keyboard focus, not under the pointer', async () => {
    stubImages();
    await show(3);
    const user = keyboard();
    fireEvent.pointerEnter(openButton());
    await advance(5000);
    expect(position()).toBe('2 of 3');
    await user.tab();
    expect(openButton()).toHaveFocus();
    await advance(15_000);
    expect(position()).toBe('2 of 3');
  });

  it('still pauses for keyboard focus after a press that ended in a cancel or outside (M1)', async () => {
    stubImages();
    await show(3, <button type="button">Outside</button>);
    const user = keyboard();
    // A native drag of the image ends the press with pointercancel, not pointerup.
    fireEvent.pointerDown(openButton());
    fireEvent.pointerCancel(openButton());
    await user.tab(); // the full-screen image button
    expect(openButton()).toHaveFocus();
    await advance(15_000);
    expect(position()).toBe('1 of 3');

    // A press inside the gallery released outside it.
    await user.tab({ shift: true });
    fireEvent.pointerDown(arrow('Next'));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Outside' }));
    await user.tab(); // the full-screen image button
    await user.tab(); // Previous
    expect(arrow('Previous')).toHaveFocus();
    await advance(15_000);
    expect(position()).toBe('1 of 3');
  });

  it('keeps turning after a touch tap on an arrow, where focus comes after pointerup (FR-024)', async () => {
    stubImages();
    await show(3);
    // The touch order: pointerdown, pointerup, then the compatibility mousedown's focus, then click.
    const tap = (el: HTMLElement) => {
      fireEvent.pointerDown(el, { pointerType: 'touch' });
      fireEvent.pointerUp(el, { pointerType: 'touch' });
      act(() => el.focus());
      fireEvent.click(el, { detail: 1 });
    };
    tap(arrow('Next'));
    expect(arrow('Next')).toHaveFocus();
    expect(position()).toBe('2 of 3');
    await advance(5000);
    expect(position()).toBe('3 of 3');
  });

  it('is announced politely only while it does not turn on its own', async () => {
    stubImages();
    const { container } = await show(3);
    const live = () => container.querySelector('[aria-live]');
    expect(live()).toHaveAttribute('aria-live', 'off');
    await keyboard().click(toggle());
    expect(live()).toHaveAttribute('aria-live', 'polite');
  });

  it('says "Image unavailable" for an image that failed, and keeps turning', async () => {
    stubImages({ 'img-2': imageResponse(404) });
    await show(3);
    await advance(5000);
    expect(position()).toBe('2 of 3');
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    await advance(5000);
    expect(position()).toBe('3 of 3');
    expect(shownAlt()).toBe(`${NAME}, image 3 of 3`);
  });

  it('sets no color in an inline style', async () => {
    stubImages();
    const { container } = await show(3);
    for (const el of container.querySelectorAll('[style]')) {
      expect(el.getAttribute('style')).not.toMatch(/color|background|font|shadow/i);
    }
  });
});

/**
 * Spec 014 FR-040 (research R11, decided 2026-10-19): the shown image slides out and the next
 * slides in, over 400 ms, toward the left for the next image and toward the right for the previous
 * one, decided by the action rather than the index. None under reduced motion.
 */
describe('ImageGallery, the slide between images (FR-040)', () => {
  const outgoing = (c: HTMLElement) => c.querySelectorAll('[class*="gallery__slide--out-"]');
  const incoming = (c: HTMLElement) => c.querySelectorAll('[class*="gallery__slide--in-"]');
  /** Each image or placeholder rendered in the slide area, outgoing or incoming. */
  const frames = (c: HTMLElement) =>
    c.querySelectorAll('.gallery__slide img, .gallery__slide .gallery__placeholder');

  const shownSrc = () => screen.getByRole('img').getAttribute('src');

  /** A slide toward `dir`, from the image whose source was `fromSrc` to image `to`. */
  async function expectSlide(
    c: HTMLElement,
    dir: 'left' | 'right',
    fromSrc: string | null,
    to: number,
  ) {
    await advance(0); // the incoming image's read, if it was not loaded yet
    const [out] = outgoing(c);
    const [inn] = incoming(c);
    expect(outgoing(c)).toHaveLength(1);
    expect(incoming(c)).toHaveLength(1);
    expect(out).toHaveClass(`gallery__slide--out-${dir}`);
    expect(inn).toHaveClass(`gallery__slide--in-${dir}`);
    expect(out).toHaveAttribute('aria-hidden', 'true');
    expect(out!.closest('.gallery__open')).toBeNull();
    expect(out!.querySelector('.gallery__open')).toBeNull();
    expect(inn!.closest('.gallery__open') ?? inn!.querySelector('.gallery__open')).not.toBeNull();
    expect(frames(c)).toHaveLength(2);
    // The image that leaves is the one shown before; the one that arrives is named.
    expect(fromSrc).toMatch(/^blob:/);
    expect(out!.querySelector('img')).toHaveAttribute('src', fromSrc);
    expect(screen.getByRole('img')).toHaveAttribute('alt', `${NAME}, image ${to} of 3`);
    expect(inn!.querySelector('img')).toBe(screen.getByRole('img'));
    expect(position()).toBe(`${to} of 3`);
  }

  it('slides left on an automatic change, and keeps only the incoming image after 400 ms', async () => {
    stubImages();
    const { container } = await show(3);
    expect(outgoing(container)).toHaveLength(0);
    expect(incoming(container)).toHaveLength(0);
    expect(frames(container)).toHaveLength(1);
    const first = shownSrc();
    await advance(5000);
    await expectSlide(container, 'left', first, 2);
    await advance(399);
    expect(frames(container)).toHaveLength(2);
    await advance(1);
    expect(frames(container)).toHaveLength(1);
    expect(outgoing(container)).toHaveLength(0);
    expect(incoming(container)).toHaveLength(0);
    expect(shownAlt()).toBe(`${NAME}, image 2 of 3`);
  });

  it('ends the slide on animationend', async () => {
    stubImages();
    const { container } = await show(3);
    await advance(5000);
    fireEvent.animationEnd(outgoing(container)[0]!);
    expect(frames(container)).toHaveLength(1);
    expect(outgoing(container)).toHaveLength(0);
  });

  it('slides left for "Next image", including from the last image to the first', async () => {
    stubImages();
    const { container } = await show(3);
    const user = keyboard();
    let before = shownSrc();
    await user.click(arrow('Next'));
    await expectSlide(container, 'left', before, 2);
    await advance(400);
    before = shownSrc();
    await user.click(arrow('Next'));
    await expectSlide(container, 'left', before, 3);
    await advance(400);
    before = shownSrc();
    await user.click(arrow('Next'));
    await expectSlide(container, 'left', before, 1);
  });

  it('slides right for "Previous image", including from the first image to the last', async () => {
    stubImages();
    const { container } = await show(3);
    const user = keyboard();
    let before = shownSrc();
    await user.click(arrow('Previous'));
    await expectSlide(container, 'right', before, 3);
    await advance(400);
    before = shownSrc();
    await user.click(arrow('Previous'));
    await expectSlide(container, 'right', before, 2);
  });

  it('starts a press during a slide from the current image, with exactly two images', async () => {
    stubImages();
    const { container } = await show(3);
    const user = keyboard();
    await user.click(arrow('Next'));
    await advance(100);
    let before = shownSrc();
    await user.click(arrow('Next'));
    await expectSlide(container, 'left', before, 3);
    await advance(100);
    before = shownSrc();
    await user.click(arrow('Previous'));
    await expectSlide(container, 'right', before, 2);
    await advance(400);
    expect(frames(container)).toHaveLength(1);
    expect(position()).toBe('2 of 3');
  });

  it('names the incoming image at once: the full-screen button and the live region', async () => {
    stubImages();
    const { container } = await show(3);
    await advance(5000);
    expect(openButton()).toHaveAccessibleName(`View ${NAME}, image 2 of 3, full screen`);
    const live = container.querySelector('[aria-live]')!;
    expect(within(live as HTMLElement).getByRole('img')).toHaveAttribute(
      'alt',
      `${NAME}, image 2 of 3`,
    );
  });

  it('waits 5,000 ms from the start of the slide for the next automatic change', async () => {
    stubImages();
    await show(3);
    await advance(5000);
    expect(position()).toBe('2 of 3');
    await advance(4999);
    expect(position()).toBe('2 of 3');
    await advance(1);
    expect(position()).toBe('3 of 3');
  });

  it('never slides under reduced motion: one image, no slide class', async () => {
    setMediaQuery(REDUCED_MOTION, true);
    stubImages();
    const { container } = await show(3);
    const user = keyboard();
    await user.click(arrow('Next'));
    expect(position()).toBe('2 of 3');
    expect(frames(container)).toHaveLength(1);
    expect(container.querySelector('[class*="gallery__slide--"]')).toBeNull();
    await user.click(arrow('Previous'));
    expect(frames(container)).toHaveLength(1);
    expect(container.querySelector('[class*="gallery__slide--"]')).toBeNull();
  });
});

/**
 * Spec 014 US4 (FR-020, FR-028, FR-032, FR-038, FR-039, FR-040; research R12, R14): the gallery on
 * an Events list card. Its image links to the event, out of the Tab order and hidden from
 * assistive technology; its arrows and Pause/Play button are outside the link; it loads only the
 * shown and next images while on or near the screen, and lets both go when it leaves.
 */
describe('ImageGallery, card variant', () => {
  interface Card {
    id: string;
    name: string;
    images: EventImage[];
  }
  const opener: Card = { id: EVENT_ID, name: NAME, images: images(3) };
  const late: Card = {
    id: 'e2',
    name: 'Late Show',
    images: images(3).map((i) => ({ ...i, id: `b-${i.position}` })),
  };

  async function cards(list: Card[]) {
    const view = renderSignedIn(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <ul>
                {list.map((c) => (
                  <li key={c.id}>
                    <ImageGallery
                      eventId={c.id}
                      eventName={c.name}
                      images={c.images}
                      variant="card"
                      eventHref={`/events/${c.id}`}
                    />
                  </li>
                ))}
              </ul>
            }
          />
          <Route path="/events/:id" element={<p>The event page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await advance(0);
    return view;
  }

  const group = (name: string) => screen.getByRole('group', { name: `Images of ${name}` });
  const cardPosition = (name: string) => within(group(name)).getByText(/^\d of \d$/).textContent;
  const link = (name: string) => group(name).querySelector('a');
  const imageIds = (calls: { path: string }[]) => calls.map((c) => c.path.split('/').pop());

  it('labels each card gallery and its arrows with its event', async () => {
    stubImages();
    await cards([opener, late]);
    for (const name of [NAME, 'Late Show']) {
      const g = group(name);
      expect(g).toHaveClass('gallery', 'gallery--card');
      expect(g).toHaveAttribute('aria-roledescription', 'carousel');
      expect(
        within(g).getByRole('button', { name: `Previous image of ${name}` }),
      ).toBeInTheDocument();
      expect(within(g).getByRole('button', { name: `Next image of ${name}` })).toBeInTheDocument();
      expect(
        within(g).getByRole('button', { name: `Pause images of ${name}` }),
      ).toBeInTheDocument();
    }
  });

  it('links the image to the event, out of the Tab order and hidden, with no full-screen button', async () => {
    stubImages();
    await cards([opener]);
    const a = link(NAME)!;
    expect(a).toHaveAttribute('href', '/events/e1');
    expect(a).toHaveAttribute('tabindex', '-1');
    expect(a).toHaveAttribute('aria-hidden', 'true');
    expect(a.querySelector('img')).toHaveAttribute('alt', `${NAME}, image 1 of 3`);
    expect(screen.queryByRole('button', { name: /full screen/ })).toBeNull();
    for (const button of within(group(NAME)).getAllByRole('button'))
      expect(button.closest('a')).toBeNull();
  });

  it('opens the event from the image, but not from an arrow or the Pause/Play button', async () => {
    stubImages();
    await cards([opener]);
    const user = keyboard();
    await user.click(screen.getByRole('button', { name: `Next image of ${NAME}` }));
    await user.click(screen.getByRole('button', { name: `Previous image of ${NAME}` }));
    await user.click(screen.getByRole('button', { name: `Pause images of ${NAME}` }));
    expect(screen.queryByText('The event page')).toBeNull();
    await user.click(link(NAME)!);
    expect(screen.getByText('The event page')).toBeInTheDocument();
  });

  it('turns each card on its own: an arrow or Pause on one card leaves the other alone', async () => {
    stubImages();
    await cards([opener, late]);
    const user = keyboard();
    const next = screen.getByRole('button', { name: `Next image of ${NAME}` });
    await user.click(next);
    fireEvent.pointerLeave(next);
    expect(cardPosition(NAME)).toBe('2 of 3');
    expect(cardPosition('Late Show')).toBe('1 of 3');
    await user.click(screen.getByRole('button', { name: `Pause images of ${NAME}` }));
    await advance(5000);
    expect(cardPosition(NAME)).toBe('2 of 3');
    expect(cardPosition('Late Show')).toBe('2 of 3');
  });

  it('uses the same slide as the event page', async () => {
    stubImages();
    const { container } = await cards([opener]);
    await advance(5000);
    const out = container.querySelector('.gallery__slide--out-left');
    expect(out).toHaveAttribute('aria-hidden', 'true');
    expect(out!.closest('a')).toBeNull();
    expect(container.querySelector('a .gallery__slide--in-left')).not.toBeNull();
    await advance(400);
    expect(container.querySelector('[class*="gallery__slide--"]')).toBeNull();
  });

  it('loads only on or near the screen, holds the shown and next images, and lets go off screen', async () => {
    const io = installIntersectionObserver();
    const { calls } = stubImages();
    await cards([{ ...opener, images: images(5) }]);
    let most = 0;
    /** Object URLs this card holds now (the only gallery on the page). */
    const held = () => {
      const n = objectUrls.live().length;
      most = Math.max(most, n);
      return n;
    };
    const shownSrc = () => link(NAME)!.querySelector('img')?.getAttribute('src');

    // Off screen at first: nothing fetched.
    expect(io.options).toContainEqual(expect.objectContaining({ rootMargin: '200px' }));
    expect(io.observed()).toContain(group(NAME));
    await advance(1000);
    expect(calls).toHaveLength(0);

    // On screen: the shown and the next image.
    act(() => io.set(group(NAME), true));
    await advance(0);
    expect(imageIds(calls).sort()).toEqual(['img-1', 'img-2']);
    expect(held()).toBe(2);
    const first = shownSrc();
    expect(first).toMatch(/^blob:/);

    // A change: the image after next is fetched; the one before goes once the slide ends.
    await advance(5000);
    expect(cardPosition(NAME)).toBe('2 of 5');
    expect(imageIds(calls).sort()).toEqual(['img-1', 'img-2', 'img-3']);
    expect(held()).toBe(3);
    await advance(400);
    expect(held()).toBe(2);
    expect(objectUrls.revoked).toContain(first);

    // Off screen: no change, and both images let go at once.
    act(() => io.set(group(NAME), false));
    await advance(0);
    expect(held()).toBe(0);
    await advance(20_000);
    expect(cardPosition(NAME)).toBe('2 of 5');
    expect(calls).toHaveLength(3);

    // Back: the same two images again, and turning from the same image.
    act(() => io.set(group(NAME), true));
    await advance(0);
    expect(imageIds(calls.slice(3)).sort()).toEqual(['img-2', 'img-3']);
    expect(held()).toBe(2);
    expect(cardPosition(NAME)).toBe('2 of 5');
    await advance(4999);
    expect(cardPosition(NAME)).toBe('2 of 5');
    await advance(1);
    expect(cardPosition(NAME)).toBe('3 of 5');
    held();
    await advance(400);
    expect(held()).toBe(2);
    expect(most).toBeLessThanOrEqual(3);
  });

  it('announces the card position from inside its live region (FR-028, T050)', async () => {
    stubImages();
    await cards([opener]);
    const user = keyboard();
    const live = () =>
      within(group(NAME))
        .getByText(/^\d of \d$/)
        .closest('[aria-live]');
    expect(live()).not.toBeNull();
    expect(group(NAME).querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(live()).toHaveAttribute('aria-live', 'off');

    // An arrow press (the pointer still over the arrow): announced.
    const next = screen.getByRole('button', { name: `Next image of ${NAME}` });
    await user.click(next);
    expect(cardPosition(NAME)).toBe('2 of 3');
    expect(live()).toHaveAttribute('aria-live', 'polite');
    fireEvent.pointerLeave(next);
    expect(live()).toHaveAttribute('aria-live', 'off');

    // Paused with the Pause/Play button: announced.
    await user.click(screen.getByRole('button', { name: `Pause images of ${NAME}` }));
    expect(live()).toHaveAttribute('aria-live', 'polite');
  });

  it('announces the card position politely under reduced motion', async () => {
    setMediaQuery(REDUCED_MOTION, true);
    stubImages();
    await cards([opener]);
    const live = within(group(NAME)).getByText('1 of 3').closest('[aria-live]');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('counts as on screen where IntersectionObserver is missing', async () => {
    const { calls } = stubImages();
    await cards([opener]);
    expect(imageIds(calls).sort()).toEqual(['img-1', 'img-2']);
    await advance(5000);
    expect(cardPosition(NAME)).toBe('2 of 3');
  });
});
