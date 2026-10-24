/**
 * Spec 014 FR-042 (research R18, issue #73): the one rule for the height of a gallery's box. The
 * box spans its full width and takes the shown picture's shape; only extreme pictures are limited,
 * and then `object-fit: contain` keeps them whole and centered (FR-041).
 */
export interface GalleryBox {
  variant: 'card' | 'page';
  /** The gallery's width in pixels. */
  width: number;
  /** The shown picture's width / height, or `null` before it has loaded (or when it failed). */
  ratio: number | null;
  /** The window's height in pixels (the event page's limit). */
  viewportHeight: number;
}

const clamp = (min: number, value: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/** A card: between a 3:4 portrait and a 2:1 panorama, 4:3 before the picture has loaded. */
const CARD_TALLEST = 3 / 4;
const CARD_FLATTEST = 2;
/** The event page: at least 200 pixels and at most 70% of the window. */
const PAGE_MIN = 200;
const PAGE_MAX_SHARE = 0.7;

export function galleryBoxHeight({ variant, width, ratio, viewportHeight }: GalleryBox): number {
  if (variant === 'card') {
    return ratio === null ? (width * 3) / 4 : width / clamp(CARD_TALLEST, ratio, CARD_FLATTEST);
  }
  // Before loading: the band's earlier height, clamp(200px, 40vw, 480px) (research R13).
  if (ratio === null) return clamp(PAGE_MIN, 0.4 * width, 480);
  return Math.max(PAGE_MIN, Math.min(width / ratio, PAGE_MAX_SHARE * viewportHeight));
}
