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

/**
 * A real 1 × 1 grey baseline JPEG (JFIF): one quantization table, one-code Huffman tables, and a
 * single block whose DC difference is 0 and whose AC is end-of-block, then `EOI`.
 */
export const JPEG = Buffer.from(
  [
    'ffd8',
    'ffe000104a46494600010100000100010000', // APP0 JFIF
    'ffdb004300' + '01'.repeat(64), // DQT
    'ffc0000b080001000101011100', // SOF0: 1 x 1, one component
    'ffc4001400' + '01' + '00'.repeat(15) + '00', // DHT DC: one code, category 0
    'ffc4001410' + '01' + '00'.repeat(15) + '00', // DHT AC: one code, end of block
    'ffda0008010100003f00', // SOS
    '3f', // scan: DC 0, EOB, padded with 1 bits
    'ffd9',
  ].join(''),
  'hex',
);

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

/**
 * A TIFF structure as found in a JPEG's Exif `APP1` (after `Exif\0\0`) or a PNG's `eXIf`: `IFD0`
 * with the camera's make, an orientation, and a pointer to a GPS IFD holding `gps` as its
 * processing method, so tests can look for those bytes after removal.
 */
export function exifTiff(
  opts: { orientation?: number; make?: string; gps?: string; littleEndian?: boolean } = {},
): Buffer {
  const le = opts.littleEndian ?? false;
  const w16 = (n: number) => {
    const b = Buffer.alloc(2);
    if (le) b.writeUInt16LE(n);
    else b.writeUInt16BE(n);
    return b;
  };
  const w32 = (n: number) => {
    const b = Buffer.alloc(4);
    if (le) b.writeUInt32LE(n);
    else b.writeUInt32BE(n);
    return b;
  };
  const make = opts.make !== undefined ? Buffer.from(`${opts.make}\0`, 'latin1') : null;
  const gps = opts.gps !== undefined ? Buffer.from(opts.gps, 'latin1') : null;
  const count = (make ? 1 : 0) + (opts.orientation !== undefined ? 1 : 0) + (gps ? 1 : 0);
  const ifd0End = 8 + 2 + count * 12 + 4;
  const makeAt = ifd0End;
  const gpsIfdAt = makeAt + (make?.length ?? 0);
  const gpsDataAt = gpsIfdAt + 2 + 12 + 4;
  const entry = (tag: number, type: number, n: number, value: Buffer) =>
    Buffer.concat([w16(tag), w16(type), w32(n), value]);
  const shortValue = (v: number) => Buffer.concat([w16(v), Buffer.alloc(2)]);
  const entries: Buffer[] = [];
  if (make) entries.push(entry(0x010f, 2, make.length, w32(makeAt)));
  if (opts.orientation !== undefined)
    entries.push(entry(0x0112, 3, 1, shortValue(opts.orientation)));
  if (gps) entries.push(entry(0x8825, 4, 1, w32(gpsIfdAt)));
  return Buffer.concat([
    Buffer.from(le ? 'II' : 'MM', 'latin1'),
    w16(42),
    w32(8),
    w16(count),
    ...entries,
    w32(0),
    make ?? Buffer.alloc(0),
    ...(gps ? [w16(1), entry(0x001b, 7, gps.length, w32(gpsDataAt)), w32(0), gps] : []),
  ]);
}

/** A JPEG Exif `APP1` segment. */
export function exifApp1(opts: Parameters<typeof exifTiff>[0] = {}): Buffer {
  return jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifTiff(opts)]));
}

/** The minimal Exif `APP1` the Backend keeps: only `IFD0` Orientation (research R17). */
export function orientationApp1(orientation: number): Buffer {
  return jpegSegment(
    0xe1,
    Buffer.concat([
      Buffer.from('Exif\0\0MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01', 'latin1'),
      Buffer.from([0, orientation, 0, 0, 0, 0, 0, 0]),
    ]),
  );
}

/**
 * The smallest Exif `APP1` the Backend reads an orientation from: one `IFD0` entry and no next-IFD
 * offset, 32 bytes in all, plus `extra` trailing bytes (review 014 round 1, M2).
 */
export function minimalExifApp1(
  orientation: number,
  opts: { littleEndian?: boolean; extra?: number } = {},
): Buffer {
  const le = opts.littleEndian ?? false;
  const tiff = Buffer.alloc(22 + (opts.extra ?? 0));
  tiff.write(le ? 'II' : 'MM', 0, 'latin1');
  const u16 = (v: number, at: number) =>
    le ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at);
  const u32 = (v: number, at: number) =>
    le ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at);
  u16(42, 2);
  u32(8, 4);
  u16(1, 8); // one entry
  u16(0x0112, 10); // Orientation
  u16(3, 12); // SHORT
  u32(1, 14); // count
  u16(orientation, 18);
  return jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
}

/** An XMP `APP1` segment (standard or extended). */
export function xmpApp1(text: string, extended = false): Buffer {
  const ns = extended ? 'http://ns.adobe.com/xmp/extension/\0' : 'http://ns.adobe.com/xap/1.0/\0';
  return jpegSegment(0xe1, Buffer.from(`${ns}${text}`, 'latin1'));
}

/** A Photoshop `APP13` (IPTC) segment. */
export function iptcApp13(text: string): Buffer {
  return jpegSegment(0xed, Buffer.from(`Photoshop 3.0\0${text}`, 'latin1'));
}

/** Where the scan of a JPEG starts: the `SOS` marker. */
export function sosAt(jpeg: Buffer): number {
  for (let i = 2; i + 1 < jpeg.length; i++) if (jpeg[i] === 0xff && jpeg[i + 1] === 0xda) return i;
  return -1;
}

/** The marker codes of a JPEG's segments before its scan, in order. */
export function jpegMarkers(jpeg: Buffer): number[] {
  const out: number[] = [];
  let at = 2;
  while (at + 3 < jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1]!;
    out.push(marker);
    if (marker === 0xda) break;
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return out;
}
