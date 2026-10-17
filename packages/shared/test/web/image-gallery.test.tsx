import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageGallery } from '../../src/web/image-gallery';
import { REDUCED_MOTION, setMediaQuery } from './browser-stubs';
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

const keyboard = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
