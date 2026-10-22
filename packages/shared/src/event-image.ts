/**
 * Spec 014: event images. Mirrors `EventImage` in contracts/openapi.yaml, and holds the one
 * type check both the Backend (authoritative) and the Admin app's preview use (research R3, R10).
 */

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

/** The contract's `EventImage.contentType` enum, in its order. */
export const IMAGE_CONTENT_TYPES: readonly ImageContentType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** One picture of an event, metadata only: the bytes are read with `getEventImage`. */
export interface EventImage {
  id: string;
  /** 1 to 5; 1 is the cover. */
  position: number;
  contentType: ImageContentType;
  /** The stored size in bytes, after metadata removal. */
  byteSize: number;
}

/** FR-001, FR-004: at most 5 images, each at most 5 MB (5 × 1024 × 1024 bytes). */
export const EVENT_IMAGE_LIMITS = { maxCount: 5, maxBytes: 5_242_880 } as const;

/** FR-036: at most 16,384 pixels a side and 40 megapixels in all (research R3). */
export const IMAGE_PIXEL_LIMITS = { maxSide: 16_384, maxPixels: 40_000_000 } as const;

/** FR-022: each gallery shows the next image every 5 seconds. */
export const GALLERY_INTERVAL_MS = 5000;

export interface ImageHeader {
  contentType: ImageContentType;
  width: number;
  height: number;
  /** An APNG (`acTL` before `IDAT`) or an animated WebP; refused by FR-037. */
  animated: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (b: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...b.subarray(at, at + length));

const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32be = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32le = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/**
 * The type a file's first 12 bytes show, or `null` (research R3). The file name and the type the
 * file was sent with are never consulted.
 */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * The type, size in pixels, and whether the picture is animated, read from headers only; `null`
 * when the file is not one of the three types, its header is cut short, or it gives no size or a
 * zero size (research R3). The pixel limits are the caller's decision.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  const contentType = sniffImageType(bytes);
  if (!contentType) return null;
  const read =
    contentType === 'image/png' ? readPng : contentType === 'image/jpeg' ? readJpeg : readWebp;
  const size = read(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return { contentType, ...size };
}

type Size = { width: number; height: number; animated: boolean } | null;

function readPng(b: Uint8Array): Size {
  // The IHDR chunk must come first: length 13 at byte 8, its type at 12, width at 16, height at 20.
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR' || u32be(b, 8) !== 13) return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  // APNG: an acTL chunk before the first IDAT.
  let animated = false;
  let at = 8;
  while (at + 8 <= b.length) {
    const length = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    if (type === 'acTL') {
      animated = true;
      break;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + length;
  }
  return { width, height, animated };
}

function readJpeg(b: Uint8Array): Size {
  let at = 2;
  while (at < b.length) {
    if (b[at] !== 0xff) return null;
    // Fill bytes before a marker code.
    while (at < b.length && b[at] === 0xff) at++;
    if (at >= b.length) return null;
    const marker = b[at]!;
    at++;
    // Standalone markers have no length.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // EOI or SOS before any frame header
    if (at + 2 > b.length) return null;
    const length = u16be(b, at);
    if (length < 2 || at + length > b.length) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (length < 7) return null;
      return { height: u16be(b, at + 3), width: u16be(b, at + 5), animated: false };
    }
    at += length;
  }
  return null;
}

function readWebp(b: Uint8Array): Size {
  if (b.length < 20) return null;
  const end = Math.min(b.length, 8 + u32le(b, 4));
  const first = ascii(b, 12, 4);
  const firstLength = u32le(b, 16);
  const data = 20;
  if (data + firstLength > end) return null;
  if (first === 'VP8X') {
    if (firstLength < 10) return null;
    const flags = b[data]!;
    let animated = (flags & 0x02) !== 0;
    // Any ANIM or ANMF chunk also marks an animation.
    let at = 12;
    while (!animated && at + 8 <= end) {
      const type = ascii(b, at, 4);
      if (type === 'ANIM' || type === 'ANMF') animated = true;
      const length = u32le(b, at + 4);
      at += 8 + length + (length % 2);
    }
    return { width: u24le(b, data + 4) + 1, height: u24le(b, data + 7) + 1, animated };
  }
  if (first === 'VP8L') {
    if (firstLength < 5 || b[data] !== 0x2f) return null;
    const v = u32le(b, data + 1);
    return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1, animated: false };
  }
  if (first === 'VP8 ') {
    if (firstLength < 10) return null;
    if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) return null;
    return {
      width: u16le(b, data + 6) & 0x3fff,
      height: u16le(b, data + 8) & 0x3fff,
      animated: false,
    };
  }
  return null;
}

/** A little-endian 16-bit value. */
function u16le(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}
