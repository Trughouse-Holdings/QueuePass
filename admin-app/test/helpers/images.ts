/**
 * Spec 014: picture files with real signatures for the Admin app's tests (research R16). Only the
 * headers matter to the form's preview; the bytes are never decoded in jsdom.
 */

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A PNG chunk; the preview does not check CRCs, so they are zeros. */
const chunk = (type: string, data: number[] = []) => [
  ...u32be(data.length),
  ...ascii(type),
  ...data,
  0,
  0,
  0,
  0,
];

/** PNG bytes: `width` × `height`, optional extra chunks before IDAT, padded to `size` bytes. */
export function pngBytes(
  opts: { width?: number; height?: number; before?: number[][]; size?: number } = {},
): Uint8Array {
  const head = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32be(opts.width ?? 2), ...u32be(opts.height ?? 2), 8, 2, 0, 0, 0]),
    ...(opts.before ?? []).flat(),
    ...chunk('IDAT', [1, 2, 3]),
  ];
  const end = chunk('IEND');
  const bytes = new Uint8Array(opts.size ?? head.length + end.length);
  bytes.set(head, 0);
  if (opts.size !== undefined) {
    // A private chunk fills the gap, so the file stays a well-formed PNG.
    const fill = opts.size - head.length - end.length - 12;
    bytes.set([...u32be(fill), ...ascii('prVt')], head.length);
  }
  bytes.set(end, bytes.length - end.length);
  return bytes;
}

export const ANIMATED_CHUNK = chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]);

/** A JPEG header: SOI, then a baseline frame of 2 × 2. */
export const jpegBytes = (): Uint8Array =>
  Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00, 0xff,
    0xd9,
  ]);

/** The 1 × 1 WebP of quickstart.md. */
export const webpBytes = (): Uint8Array =>
  Uint8Array.from(atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='), (c) => c.charCodeAt(0));

export const gifBytes = (): Uint8Array => Uint8Array.from(ascii('GIF89a\x01\x00\x01\x00\x00\x00'));

const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes], name, { type });

export const pngFile = (name = 'stage.png', opts: Parameters<typeof pngBytes>[0] = {}) =>
  file(pngBytes(opts), name, 'image/png');
export const jpegFile = (name = 'crowd.jpg') => file(jpegBytes(), name, 'image/jpeg');
export const webpFile = (name = 'poster.webp') => file(webpBytes(), name, 'image/webp');
export const gifFile = (name = 'anim.gif') => file(gifBytes(), name, 'image/gif');
export const textFile = (name = 'fake.jpg') =>
  file(Uint8Array.from(ascii('not a picture, honestly\n')), name, 'image/jpeg');
/** A PNG whose header is fine but whose next chunk runs past the end of the file. */
export const brokenPngFile = (name = 'broken.png') =>
  file(
    Uint8Array.from([...pngBytes().slice(0, 33), ...u32be(99), ...ascii('IDAT')]),
    name,
    'image/png',
  );

/** The metadata of a stored image, as the Backend lists it. */
export const savedImage = (id: string, position: number, contentType = 'image/png') => ({
  id,
  position,
  contentType,
  byteSize: 100 + position,
});
