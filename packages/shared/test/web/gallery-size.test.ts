import { describe, it, expect } from 'vitest';
import { galleryBoxHeight } from '../../src/web/gallery-size';

/**
 * Spec 014 FR-042 (research R18, issue #73): the height of a gallery's box, from its width and the
 * shown picture's shape (`ratio`, width / height, or `null` before it has loaded).
 */
describe('galleryBoxHeight', () => {
  describe('on a card: between a 3:4 portrait and a 2:1 panorama, 4:3 before loading', () => {
    it.each([
      [4 / 3, 240],
      [1, 320],
      [0.5, 426.67], // limited to 3:4
      [3, 160], // limited to 2:1
      [null, 240],
    ])('width 320, ratio %s → %s', (ratio, height) => {
      expect(
        galleryBoxHeight({ variant: 'card', width: 320, ratio, viewportHeight: 900 }),
      ).toBeCloseTo(height, 2);
    });
  });

  describe('on the event page: 200 pixels to 70% of the window, clamp(200, 40vw, 480) before loading', () => {
    it.each([
      [1280, 16 / 9, 630], // 70% of 900
      [1280, 3, 426.67],
      [1280, 10, 200], // the minimum
      [1280, null, 480],
      [375, null, 200],
    ])('width %s, window height 900, ratio %s → %s', (width, ratio, height) => {
      expect(galleryBoxHeight({ variant: 'page', width, ratio, viewportHeight: 900 })).toBeCloseTo(
        height,
        2,
      );
    });
  });
});
