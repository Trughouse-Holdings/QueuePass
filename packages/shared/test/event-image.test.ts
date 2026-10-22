import { describe, it, expect } from 'vitest';
import {
  EVENT_IMAGE_LIMITS,
  GALLERY_INTERVAL_MS,
  IMAGE_CONTENT_TYPES,
  IMAGE_PIXEL_LIMITS,
  readImageHeader,
  sniffImageType,
} from '../src/event-image';

/** Spec 014 FR-003, FR-036, FR-037; research R3. Files are built byte by byte. */

const bytes = (...parts: (number[] | string | Uint8Array)[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  return Uint8Array.from(out);
};
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A chunk; the CRC is not checked by the header reader, so zeros do. */
const chunk = (type: string, data: number[] = []) => [
  ...u32be(data.length),
  ...bytes(type),
  ...data,
  0,
  0,
  0,
  0,
];
const ihdr = (w: number, h: number) => chunk('IHDR', [...u32be(w), ...u32be(h), 8, 2, 0, 0, 0]);
const png = (w: number, h: number, ...extra: number[][]) =>
  bytes(PNG_SIG, ihdr(w, h), ...extra, chunk('IDAT', [1, 2, 3]), chunk('IEND'));

const seg = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16be(payload.length + 2),
  ...payload,
];
const sof = (marker: number, w: number, h: number) =>
  seg(marker, [8, ...u16be(h), ...u16be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const jpeg = (...segments: number[][]) =>
  bytes([0xff, 0xd8], ...segments, seg(0xda, [1, 1, 0, 0, 0x3f, 0]), [1, 2, 3, 0xff, 0xd9]);
const exifApp1 = seg(0xe1, [...bytes('Exif\0\0'), 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0]);

const riff = (...chunks: number[][]) => {
  const body = bytes('WEBP', ...chunks);
  return bytes('RIFF', u32le(body.length), body);
};
const wchunk = (type: string, data: number[]) => [
  ...bytes(type),
  ...u32le(data.length),
  ...data,
  ...(data.length % 2 ? [0] : []),
];
const vp8x = (flags: number, w: number, h: number) =>
  wchunk('VP8X', [flags, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
const vp8l = (w: number, h: number) => {
  const v = (w - 1) | ((h - 1) << 14);
  return wchunk('VP8L', [0x2f, ...u32le(v >>> 0), 0, 0]);
};
const vp8 = (w: number, h: number) =>
  wchunk('VP8 ', [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8, 0, 0]);

describe('constants', () => {
  it('match the contract and the spec', () => {
    expect(IMAGE_PIXEL_LIMITS).toEqual({ maxSide: 16384, maxPixels: 40000000 });
    expect(EVENT_IMAGE_LIMITS).toEqual({ maxCount: 5, maxBytes: 5242880 });
    expect(IMAGE_CONTENT_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(GALLERY_INTERVAL_MS).toBe(5000);
  });
});

describe('sniffImageType', () => {
  it('recognizes the three signatures', () => {
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0], new Array(8).fill(0)))).toBe(
      'image/jpeg',
    );
    expect(sniffImageType(bytes(PNG_SIG, [0, 0, 0, 13]))).toBe('image/png');
    expect(sniffImageType(bytes('RIFF', [1, 2, 3, 4], 'WEBP'))).toBe('image/webp');
  });

  it('refuses everything else', () => {
    expect(sniffImageType(bytes('GIF89a', [1, 0, 1, 0, 0, 0]))).toBeNull();
    expect(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(bytes('RIFF', [1, 2, 3, 4], 'WAVE'))).toBeNull();
    expect(sniffImageType(bytes('%PDF-1.7\n%abc'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull();
  });

  it('needs 12 bytes (both sides)', () => {
    expect(sniffImageType(bytes(PNG_SIG, [0, 0, 0]))).toBeNull();
    expect(sniffImageType(bytes(PNG_SIG, [0, 0, 0, 0]))).toBe('image/png');
  });
});

describe('readImageHeader', () => {
  it('reads a PNG', () => {
    expect(readImageHeader(png(640, 480))).toEqual({
      contentType: 'image/png',
      width: 640,
      height: 480,
      animated: false,
    });
  });

  it('reads a JPEG with an Exif APP1 before SOF0', () => {
    expect(readImageHeader(jpeg(exifApp1, sof(0xc0, 1024, 768)))).toEqual({
      contentType: 'image/jpeg',
      width: 1024,
      height: 768,
      animated: false,
    });
  });

  it('reads a progressive JPEG (SOF2), skipping DHT', () => {
    const dht = seg(0xc4, [0, ...new Array(16).fill(0)]);
    expect(readImageHeader(jpeg(dht, sof(0xc2, 300, 200)))).toMatchObject({
      contentType: 'image/jpeg',
      width: 300,
      height: 200,
    });
  });

  it('reads a WebP VP8, VP8L, and VP8X', () => {
    expect(readImageHeader(riff(vp8(320, 240)))).toEqual({
      contentType: 'image/webp',
      width: 320,
      height: 240,
      animated: false,
    });
    expect(readImageHeader(riff(vp8l(1, 1)))).toEqual({
      contentType: 'image/webp',
      width: 1,
      height: 1,
      animated: false,
    });
    expect(readImageHeader(riff(vp8l(16384, 2)))).toMatchObject({ width: 16384, height: 2 });
    expect(readImageHeader(riff(vp8x(0, 5000, 3000), vp8(5000 & 0x3fff, 3000)))).toEqual({
      contentType: 'image/webp',
      width: 5000,
      height: 3000,
      animated: false,
    });
  });

  it('reads the 1-pixel WebP of the quickstart', () => {
    const tiny = Uint8Array.from(atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='), (c) =>
      c.charCodeAt(0),
    );
    expect(readImageHeader(tiny)).toEqual({
      contentType: 'image/webp',
      width: 1,
      height: 1,
      animated: false,
    });
  });

  it('reports sizes above the pixel limits without refusing them (the caller decides)', () => {
    expect(readImageHeader(png(20000, 20000))).toMatchObject({ width: 20000, height: 20000 });
  });

  it('reports an animated PNG (acTL before IDAT)', () => {
    expect(readImageHeader(png(10, 10, chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])))).toMatchObject({
      contentType: 'image/png',
      animated: true,
    });
  });

  it('reports an animated WebP (VP8X flag or ANIM chunk)', () => {
    expect(readImageHeader(riff(vp8x(0x02, 10, 10)))).toMatchObject({ animated: true });
    expect(
      readImageHeader(riff(vp8x(0, 10, 10), wchunk('ANIM', [0, 0, 0, 0, 0, 0]))),
    ).toMatchObject({ animated: true });
  });

  it('refuses unreadable headers', () => {
    // First chunk not IHDR.
    expect(
      readImageHeader(bytes(PNG_SIG, chunk('tEXt', [1, 2, 3]), ihdr(10, 10), chunk('IEND'))),
    ).toBeNull();
    // JPEG with no SOFn.
    expect(readImageHeader(jpeg(exifApp1))).toBeNull();
    // A segment cut short.
    expect(readImageHeader(bytes([0xff, 0xd8], [0xff, 0xe1, 0x00, 0x40, 1, 2, 3]))).toBeNull();
    // A truncated IHDR.
    expect(readImageHeader(png(10, 10).slice(0, 20))).toBeNull();
    // Zero width.
    expect(readImageHeader(png(0, 10))).toBeNull();
    expect(readImageHeader(jpeg(sof(0xc0, 0, 10)))).toBeNull();
    // Not a picture.
    expect(readImageHeader(bytes('GIF89a', [1, 0, 1, 0, 0, 0]))).toBeNull();
  });
});
