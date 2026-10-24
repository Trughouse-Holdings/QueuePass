import { describe, it, expect } from 'vitest';
import { galleryBoxHeight } from '../../src/web/gallery-size';

/**
 * Spec 014 FR-042 (research R18, issue #73): the height of a gallery's box, from its width and the
 * shown picture's shape (`ratio`, width / height, or `null` when no shape is known yet). Each
 * limit is tested at, just inside, and beyond it (Constitution VI).
 */
describe('galleryBoxHeight', () => {
  const card = (width: number, ratio: number | null) =>
    galleryBoxHeight({ variant: 'card', width, ratio, viewportHeight: 900 });
  const page = (width: number, ratio: number | null, viewportHeight = 900) =>
    galleryBoxHeight({ variant: 'page', width, ratio, viewportHeight });

  describe('on a card: between a 3:4 portrait and a 2:1 panorama, 4:3 with no shape', () => {
    it.each([
      [4 / 3, 240],
      [1, 320],
      [null, 240],
      [0.8, 400], // inside 3:4
      [0.75, 426.67], // at 3:4
      [0.5, 426.67], // beyond: limited to 3:4
      [1.9, 168.42], // inside 2:1
      [2, 160], // at 2:1
      [3, 160], // beyond: limited to 2:1
    ])('width 320, ratio %s → %s', (ratio, height) => {
      expect(card(320, ratio)).toBeCloseTo(height, 2);
    });
  });

  describe('on a card: never under 160 pixels, so the controls never overlap (review S1)', () => {
    it.each([
      [263, 3, 160], // not 131.5
      [300, 2, 160], // 2:1 would be 150
      [330, 2, 165], // above the floor, 2:1 stands
      [200, null, 160], // 4:3 would be 150
    ])('width %s, ratio %s → %s', (width, ratio, height) => {
      expect(card(width, ratio)).toBeCloseTo(height, 2);
    });
  });

  describe('on the event page: 200 pixels to 70% of the window, clamp(200, 40vw, 480) with no shape', () => {
    it.each([
      [1280, 16 / 9, 630], // beyond 70% of 900
      [1280, 1280 / 640, 630], // just beyond
      [1280, 1280 / 630, 630], // at
      [1280, 1280 / 620, 620], // inside
      [1280, 3, 426.67],
      [1280, 1280 / 210, 210], // inside the minimum
      [1280, 6.4, 200], // at the minimum
      [1280, 10, 200], // beyond: the minimum
      [1280, null, 480],
      [375, null, 200],
    ])('width %s, window height 900, ratio %s → %s', (width, ratio, height) => {
      expect(page(width, ratio)).toBeCloseTo(height, 2);
    });

    it('lets 200 pixels win when 70% of the window is under it (a short landscape phone)', () => {
      expect(page(1280, 1, 250)).toBe(200);
    });
  });
});
