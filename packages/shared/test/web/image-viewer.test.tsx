import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../../src/web/auth-provider';
import { ImageGallery } from '../../src/web/image-gallery';
import { REDUCED_MOTION, setMediaQuery } from './browser-stubs';
import { fakeUserManager } from './fake-user-manager';
import { advance, EVENT_ID, images, stubImages, user as customer } from './image-helpers';

/**
 * Spec 014 US5 (FR-029, FR-030, FR-040; research R11, R12): the full-screen view, opened from the
 * event page gallery. It never changes on its own, traps focus, makes the app behind inert, and
 * returns focus to the gallery's image when it closes.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.getElementById('root')?.remove();
});

const NAME = 'Season Opener';

/** The gallery as the apps mount it: inside `#root`, so the viewer's portal is outside it. */
async function page(count: number) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  render(
    <AuthProvider userManager={fakeUserManager(customer)} apiBaseUrl="http://api.test">
      <div className="page-band">
        <ImageGallery eventId={EVENT_ID} eventName={NAME} images={images(count)} variant="page" />
      </div>
      <button type="button">Behind</button>
    </AuthProvider>,
    { container: root },
  );
  await advance(0);
  return root;
}

const keyboard = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
const galleryPosition = () =>
  within(screen.getByRole('group', { name: `Images of ${NAME}`, hidden: true })).getByText(
    /^\d of \d$/,
  ).textContent;
const openButton = () =>
  screen.getByRole('button', { name: /^View Season Opener, image \d of \d, full screen$/ });
const dialog = () => screen.getByRole('dialog');

/** Opens full screen from the gallery once it shows image `n`. */
async function openAt(n: number) {
  const user = keyboard();
  for (let i = 1; i < n; i++) {
    await user.click(screen.getByRole('button', { name: `Next image of ${NAME}` }));
    await advance(400);
  }
  await user.click(openButton());
  await advance(0);
  return user;
}

describe('ImageViewer', () => {
  it('opens on the shown image as a modal dialog over the app, which becomes inert', async () => {
    stubImages();
    const root = await page(3);
    await openAt(2);

    const d = dialog();
    expect(d.parentElement).toBe(document.body);
    expect(root.contains(d)).toBe(false);
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveAccessibleName(`${NAME}, image 2 of 3`);
    expect(d).toHaveClass('viewer');
    expect(within(d).getByRole('img')).toHaveAttribute('alt', `${NAME}, image 2 of 3`);
    expect(within(d).getByRole('img')).toHaveClass('viewer__image');
    expect(within(d).getByText('2 of 3')).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Previous image' })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Next image' })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Close full screen' })).toBeInTheDocument();
    expect(document.body).toHaveClass('viewer-open');
    expect(root).toHaveAttribute('inert');
  });

  it('moves focus to Close, and keeps Tab and Shift+Tab among its three buttons', async () => {
    stubImages();
    await page(3);
    const user = await openAt(1);
    const close = screen.getByRole('button', { name: 'Close full screen' });
    const prev = screen.getByRole('button', { name: 'Previous image' });
    const next = screen.getByRole('button', { name: 'Next image' });
    expect(close).toHaveFocus();
    const seen = new Set<Element | null>();
    for (let i = 0; i < 6; i++) {
      await user.tab();
      seen.add(document.activeElement);
    }
    expect(seen).toEqual(new Set([close, prev, next]));
    for (let i = 0; i < 6; i++) {
      await user.tab({ shift: true });
      expect([close, prev, next]).toContain(document.activeElement);
    }
  });

  it('flips with the arrow keys and buttons, wrapping both ways', async () => {
    stubImages();
    await page(3);
    const user = await openAt(2);
    await user.keyboard('{ArrowRight}');
    expect(dialog()).toHaveAccessibleName(`${NAME}, image 3 of 3`);
    await user.click(screen.getByRole('button', { name: 'Next image' }));
    expect(dialog()).toHaveAccessibleName(`${NAME}, image 1 of 3`);
    expect(within(dialog()).getByText('1 of 3')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(dialog()).toHaveAccessibleName(`${NAME}, image 3 of 3`);
    await user.click(screen.getByRole('button', { name: 'Previous image' }));
    expect(dialog()).toHaveAccessibleName(`${NAME}, image 2 of 3`);
  });

  it('never changes on its own, and the gallery behind does not either', async () => {
    stubImages();
    await page(3);
    await openAt(2);
    await advance(20_000);
    expect(dialog()).toHaveAccessibleName(`${NAME}, image 2 of 3`);
    expect(galleryPosition()).toBe('2 of 3');
  });

  it('closes with Esc on the image last viewed, and gives focus back to the gallery image', async () => {
    stubImages();
    const root = await page(3);
    const user = await openAt(2);
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(galleryPosition()).toBe('3 of 3');
    expect(openButton()).toHaveAccessibleName(`View ${NAME}, image 3 of 3, full screen`);
    expect(openButton()).toHaveFocus();
    expect(document.body).not.toHaveClass('viewer-open');
    expect(root).not.toHaveAttribute('inert');
  });

  it('closes with the close button the same way', async () => {
    stubImages();
    const root = await page(3);
    const user = await openAt(1);
    await user.click(screen.getByRole('button', { name: 'Previous image' }));
    await user.click(screen.getByRole('button', { name: 'Close full screen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(galleryPosition()).toBe('3 of 3');
    expect(openButton()).toHaveFocus();
    expect(document.body).not.toHaveClass('viewer-open');
    expect(root).not.toHaveAttribute('inert');
  });

  it('keeps the gallery turning after a pointer closes the view (FR-024, research R11)', async () => {
    stubImages();
    await page(3);
    const user = await openAt(1);
    await user.click(screen.getByRole('button', { name: 'Close full screen' }));
    expect(openButton()).toHaveFocus();
    await advance(5000);
    expect(galleryPosition()).toBe('2 of 3');
  });

  it('pauses the gallery after a keyboard close, while the image button has focus (FR-024)', async () => {
    stubImages();
    await page(3);
    const user = await openAt(1);
    await user.keyboard('{Escape}');
    await advance(15_000);
    expect(galleryPosition()).toBe('1 of 3');

    await user.click(openButton());
    await advance(0);
    await user.keyboard('{Enter}'); // the close button has focus
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openButton()).toHaveFocus();
    await advance(15_000);
    expect(galleryPosition()).toBe('1 of 3');
  });

  it('still takes Esc and the arrow keys after a click on the picture or the backdrop (FR-029)', async () => {
    stubImages();
    await page(3);
    const user = await openAt(1);
    await user.click(within(dialog()).getByRole('img'));
    await user.keyboard('{ArrowRight}');
    expect(dialog()).toHaveAccessibleName(`${NAME}, image 2 of 3`);
    await user.click(dialog());
    await user.keyboard('{ArrowLeft}');
    expect(dialog()).toHaveAccessibleName(`${NAME}, image 1 of 3`);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows one image with the close button, no arrows, and no position', async () => {
    stubImages();
    await page(1);
    await openAt(1);
    const d = dialog();
    expect(d).toHaveAccessibleName(`${NAME}, image 1 of 1`);
    expect(
      within(d)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Close full screen']);
    expect(within(d).queryByText(/of 1$/)).toBeNull();
  });

  it('requests the shown image and its neighbors', async () => {
    const { calls } = stubImages();
    await page(5);
    // The gallery loads the shown image and the next one.
    expect(calls.map((c) => c.path.split('/').pop()).sort()).toEqual(['img-1', 'img-2']);
    await openAt(1);
    expect(calls.map((c) => c.path.split('/').pop()).sort()).toEqual(['img-1', 'img-2', 'img-5']);
  });

  it('slides between images as the galleries do (FR-040)', async () => {
    stubImages();
    await page(3);
    const user = await openAt(1);
    await user.click(screen.getByRole('button', { name: 'Next image' }));
    const out = dialog().querySelector('.gallery__slide--out-left');
    expect(out).toHaveAttribute('aria-hidden', 'true');
    expect(dialog().querySelector('.gallery__slide--in-left')).not.toBeNull();
    await advance(400);
    expect(dialog().querySelector('[class*="gallery__slide--"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Previous image' }));
    expect(dialog().querySelector('.gallery__slide--out-right')).not.toBeNull();
    expect(dialog().querySelector('.gallery__slide--in-right')).not.toBeNull();
  });

  it('changes with no slide under reduced motion', async () => {
    setMediaQuery(REDUCED_MOTION, true);
    stubImages();
    await page(3);
    const user = await openAt(1);
    await user.click(screen.getByRole('button', { name: 'Next image' }));
    expect(dialog()).toHaveAccessibleName(`${NAME}, image 2 of 3`);
    expect(dialog().querySelector('[class*="gallery__slide--"]')).toBeNull();
    expect(within(dialog()).getAllByRole('img')).toHaveLength(1);
  });

  it('sets no color in an inline style', async () => {
    stubImages();
    await page(3);
    await openAt(1);
    act(() => undefined);
    for (const el of dialog().querySelectorAll('[style]')) {
      expect(el.getAttribute('style')).not.toMatch(/color|background|font|shadow/i);
    }
  });
});
