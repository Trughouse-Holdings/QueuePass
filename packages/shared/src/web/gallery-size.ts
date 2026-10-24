/**
 * Spec 014 FR-042 (research R18, issue #73): the one rule for the height of a gallery's box. The
 * box spans its full width and takes the shown picture's shape; only extreme pictures are limited,
 * and then `object-fit: contain` keeps them whole and centered (FR-041).
 */
export interface GalleryBox {
  variant: 'card' | 'page';
  /** The gallery's width in pixels. */
  width: number;
  /**
   * The shape to show, width / height: the shown picture's, else the last one the gallery showed;
   * `null` only when no picture's shape is known yet (none has loaded, or the first one failed).
   */
  ratio: number | null;
  /** The window's small height in pixels (CSS `100svh`), the event page's limit. */
  viewportHeight: number;
}

const clamp = (min: number, value: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/** A card: between a 3:4 portrait and a 2:1 panorama, 4:3 with no shape. */
const CARD_TALLEST = 3 / 4;
const CARD_FLATTEST = 2;
/**
 * A card is never shorter than this, so the centered 44-pixel arrow and the 44-pixel Pause/Play
 * 12 pixels from the bottom never overlap (they need 156; review of #73, S1).
 */
export const CARD_MIN_HEIGHT = 160;
/** The event page: at least 200 pixels and at most 70% of the window; 200 wins a conflict. */
const PAGE_MIN = 200;
const PAGE_MAX_SHARE = 0.7;

export function galleryBoxHeight({ variant, width, ratio, viewportHeight }: GalleryBox): number {
  if (variant === 'card') {
    const shaped =
      ratio === null ? (width * 3) / 4 : width / clamp(CARD_TALLEST, ratio, CARD_FLATTEST);
    return Math.max(CARD_MIN_HEIGHT, shaped);
  }
  // With no shape: the band's starting height, clamp(200px, 40vw, 480px) (research R13).
  if (ratio === null) return clamp(PAGE_MIN, 0.4 * width, 480);
  return Math.max(PAGE_MIN, Math.min(width / ratio, PAGE_MAX_SHARE * viewportHeight));
}
