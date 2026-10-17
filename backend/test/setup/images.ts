import { crc32 } from 'node:zlib';
import type { Test } from 'supertest';
import { as } from './authed-request';
import type { TestContext } from './test-app';

/**
 * Spec 014 test images (research R16): small valid pictures of each accepted type, builders for
 * hand-made files, and the upload helper. Nothing here is a committed picture file.
 */

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/** A real 2 × 2 RGB PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGM4IScnJ3eCQe6E3IkTcgAefAS72s0pYwAAAABJRU5ErkJggg==',
  'base64',
);

/** A real 1 × 1 grey progressive JPEG (JFIF), ending with its `EOI`. */
export const JPEG = Buffer.concat([
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
  Buffer.from([0xff, 0xd9]),
]);

/** A real 1 × 1 lossless WebP (`VP8L`), the one in quickstart.md. */
export const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

const u32be = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u32le = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** One PNG chunk with its real CRC. */
export function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32be(data.length), typed, u32be(crc32(typed))]);
}

/** The chunks of a PNG, after its signature. */
export function pngChunks(png: Buffer): { type: string; data: Buffer; raw: Buffer }[] {
  const out: { type: string; data: Buffer; raw: Buffer }[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    out.push({
      type,
      data: png.subarray(at + 8, at + 8 + length),
      raw: png.subarray(at, at + 12 + length),
    });
    at += 12 + length;
  }
  return out;
}

/**
 * A PNG of `width` × `height` with `before` chunks between `IHDR` and `IDAT`, and `after` chunks
 * between `IDAT` and `IEND`. Only the 2 × 2 default decodes; the others are header-only test files,
 * which is all the Backend reads.
 */
export function pngOf(
  width = 2,
  height = 2,
  opts: { before?: Buffer[]; after?: Buffer[]; trailing?: Buffer } = {},
): Buffer {
  const chunks = pngChunks(PNG);
  const ihdr = Buffer.from(chunks[0]!.data);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...(opts.before ?? []),
    chunks[1]!.raw,
    ...(opts.after ?? []),
    chunks[2]!.raw,
    opts.trailing ?? Buffer.alloc(0),
  ]);
}

/**
 * `image` (a PNG) grown to exactly `totalBytes` with a private `prVt` chunk before `IEND`, as in
 * quickstart.md. A private chunk is not metadata, so the stored size is `totalBytes`.
 */
export function padded(image: Buffer, totalBytes: number): Buffer {
  if (!image.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('padded() takes a PNG');
  const iend = image.length - 12;
  const fill = totalBytes - image.length - 12;
  if (fill < 0) throw new Error(`Cannot pad ${image.length} bytes to ${totalBytes}`);
  return Buffer.concat([
    image.subarray(0, iend),
    pngChunk('prVt', Buffer.alloc(fill, 0x2a)),
    image.subarray(iend),
  ]);
}

/** One JPEG marker segment with its length. */
export function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** The `JFIF` `APP0` segment of `JPEG`. */
export const JFIF_APP0 = JPEG.subarray(2, 20);

/**
 * A JPEG: `SOI`, the `JFIF` `APP0` when `jfif`, then `segments`, then the rest of `JPEG` (its
 * tables, frame header, scan, and `EOI`), then `trailing` bytes after the `EOI`.
 */
export function jpegWith(
  segments: Buffer[],
  opts: { jfif?: boolean; trailing?: Buffer } = {},
): Buffer {
  return Buffer.concat([
    JPEG.subarray(0, 2),
    ...(opts.jfif ? [JFIF_APP0] : []),
    ...segments,
    JPEG.subarray(20),
    opts.trailing ?? Buffer.alloc(0),
  ]);
}

/** One WebP (RIFF) chunk, padded to an even length. */
export function webpChunk(type: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(type, 'latin1'),
    u32le(data.length),
    data,
    data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
}

/** A WebP file of `chunks`, with a correct `RIFF` size, and `trailing` bytes past it. */
export function webpOf(chunks: Buffer[], trailing: Buffer = Buffer.alloc(0)): Buffer {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(body.length), body, trailing]);
}

/** A `VP8X` header chunk with `flags`, for a `width` × `height` canvas. */
export function vp8x(flags: number, width: number, height: number): Buffer {
  const d = Buffer.alloc(10);
  d[0] = flags;
  d.writeUIntLE(width - 1, 4, 3);
  d.writeUIntLE(height - 1, 7, 3);
  return webpChunk('VP8X', d);
}

/** The `VP8L` chunk of `WEBP` (a 1 × 1 picture). */
export const WEBP_VP8L = WEBP.subarray(12);

/**
 * Uploads `bytes` as the one `file` part of `uploadEventImage`, through the contract-checking
 * client. The file name and declared type default to harmless values; the Backend ignores both.
 */
export function upload(
  ctx: TestContext,
  eventId: string,
  bytes: Buffer,
  opts: { filename?: string; contentType?: string; token?: string } = {},
): Test {
  return as(ctx, opts.token ?? ctx.adminToken)
    .post(`/events/${eventId}/images`)
    .attach('file', bytes, {
      filename: opts.filename ?? 'picture.bin',
      contentType: opts.contentType ?? 'application/octet-stream',
    });
}
