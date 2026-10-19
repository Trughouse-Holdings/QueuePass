import { HttpException, HttpStatus } from '@nestjs/common';
import { IMAGE_CONTENT_TYPES, type ImageContentType } from '@queuepass/shared';

/**
 * Spec 014 FR-035; research R17. Copies a picture leaving out its location, camera, and text
 * metadata, and anything after the end of the main picture, without touching the picture data:
 *
 * - JPEG: drops Exif and XMP `APP1`, `APP2` `MPF`, `APP13`, and `COM`; stops after the first
 *   `EOI`. An Exif Orientation of 2 to 8 is kept in a minimal Exif `APP1` of its own, never longer
 *   than the Exif segment it was read from, so the file never grows past the size limit.
 * - PNG: drops `eXIf`, `tEXt`, `iTXt`, `zTXt`, and `tIME`; stops after `IEND`.
 * - WebP: drops `EXIF` and `XMP `, clears their `VP8X` flags, drops bytes past the declared `RIFF`
 *   length, and rewrites the `RIFF` size.
 *
 * A structure that cannot be walked (a segment or chunk length past the end of the file) is the
 * `415 IMAGE_TYPE_NOT_ALLOWED` envelope, as an unreadable header is (research R3).
 */
export function stripImageMetadata(bytes: Uint8Array, contentType: ImageContentType): Uint8Array {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (contentType === 'image/jpeg') return stripJpeg(b);
  if (contentType === 'image/png') return stripPng(b);
  return stripWebp(b);
}

/** The refusal for a file that is not a picture we can read (research R3). */
export function notAPicture(): HttpException {
  return new HttpException(
    {
      error: {
        code: 'IMAGE_TYPE_NOT_ALLOWED',
        message: 'This file is not a JPG, PNG, or WebP picture.',
        details: { allowed: [...IMAGE_CONTENT_TYPES] },
      },
    },
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  );
}

const startsWith = (b: Buffer, at: number, text: string): boolean =>
  b.length >= at + text.length && b.toString('latin1', at, at + text.length) === text;

const XMP = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXTENDED = 'http://ns.adobe.com/xmp/extension/\0';

/** Markers with no length: RST0 to RST7, and TEM. */
const isStandalone = (marker: number) => (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01;

function stripJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)]; // SOI
  let orientation: number | null = null;
  // The length of the Exif segment the orientation was read from.
  let orientationFrom = 0;
  // Where the orientation segment goes: after SOI, or after a JFIF APP0 that comes first.
  let insertAt = 1;
  let at = 2;
  let first = true;

  const takeSegment = (): void => {
    // at points at the 0xFF of a marker; skip fill bytes.
    while (at + 1 < b.length && b[at + 1] === 0xff) at++;
    if (at + 1 >= b.length) {
      at = b.length;
      return;
    }
    const marker = b[at + 1]!;
    const start = at;
    if (isStandalone(marker)) {
      out.push(b.subarray(start, at + 2));
      at += 2;
      return;
    }
    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9]));
      at = b.length; // the first EOI ends the picture; anything after it is dropped
      return;
    }
    if (at + 4 > b.length) throw notAPicture();
    const length = b.readUInt16BE(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > b.length) throw notAPicture();
    const payload = 4 + at;
    const segment = b.subarray(start, end);
    at = end;

    if (marker === 0xe0 && first && startsWith(b, payload, 'JFIF\0')) {
      out.push(segment);
      insertAt = out.length;
    } else if (marker === 0xe1 && startsWith(b, payload, 'Exif\0\0')) {
      if (orientation === null) {
        orientation = readOrientation(b.subarray(payload + 6, end));
        orientationFrom = segment.length;
      }
    } else if (
      (marker === 0xe1 && (startsWith(b, payload, XMP) || startsWith(b, payload, XMP_EXTENDED))) ||
      (marker === 0xe2 && startsWith(b, payload, 'MPF\0')) ||
      marker === 0xed ||
      marker === 0xfe
    ) {
      // metadata: dropped
    } else {
      out.push(segment);
    }
    first = false;

    if (marker === 0xda) copyScan();
  };

  /** From after an SOS header to the next marker that ends the scan. */
  const copyScan = (): void => {
    const start = at;
    while (at < b.length) {
      if (b[at] === 0xff && at + 1 < b.length) {
        const next = b[at + 1]!;
        if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        if (next === 0xff) {
          // fill bytes before a marker that ends the scan
          let k = at + 1;
          while (k < b.length && b[k] === 0xff) k++;
          if (k < b.length && b[k] !== 0x00 && !(b[k]! >= 0xd0 && b[k]! <= 0xd7)) break;
        }
        at += 2;
        continue;
      }
      at++;
    }
    out.push(b.subarray(start, Math.min(at, b.length)));
  };

  while (at < b.length) {
    if (b[at] !== 0xff) throw notAPicture();
    takeSegment();
  }

  if (orientation !== null && orientation >= 2 && orientation <= 8) {
    out.splice(insertAt, 0, orientationSegment(orientation, orientationFrom));
  }
  return Buffer.concat(out);
}

/** The Orientation (0x0112) of IFD0 in a TIFF structure, or `null`. Never throws. */
function readOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (at: number) => (le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (le ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) return u16(entry + 8);
  }
  return null;
}

/**
 * A minimal Exif APP1 with only IFD0 Orientation: a 32-byte payload (research R17). An Exif segment
 * that holds an orientation is at least 32 bytes (its one entry ends there), so when the one it
 * replaces is shorter than this one's 36, it is cut to that length, dropping only the zero
 * next-IFD offset: the stored file is never larger than the file as sent (FR-004, FR-035).
 */
function orientationSegment(orientation: number, atMost: number): Buffer {
  const payload = Buffer.alloc(32);
  payload.write('Exif\0\0MM', 0, 'latin1');
  payload.writeUInt16BE(42, 8);
  payload.writeUInt32BE(8, 10);
  payload.writeUInt16BE(1, 14); // one entry
  payload.writeUInt16BE(0x0112, 16); // Orientation
  payload.writeUInt16BE(3, 18); // SHORT
  payload.writeUInt32BE(1, 20); // count
  payload.writeUInt16BE(orientation, 24); // value, left-justified
  // bytes 26 to 31: value padding and no next IFD, all zero
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 34]), payload]);
  if (atMost >= segment.length) return segment;
  const cut = segment.subarray(0, atMost);
  cut.writeUInt16BE(atMost - 2, 2);
  return cut;
}

const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let at = 8;
  while (at < b.length) {
    if (at + 12 > b.length) throw notAPicture();
    const length = b.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > b.length) throw notAPicture();
    const type = b.toString('latin1', at + 4, at + 8);
    if (!PNG_DROPPED.has(type)) out.push(b.subarray(at, end));
    at = end;
    if (type === 'IEND') break; // anything after IEND is dropped
  }
  return Buffer.concat(out);
}

const WEBP_DROPPED = new Set(['EXIF', 'XMP ']);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function stripWebp(b: Buffer): Buffer {
  if (b.length < 12) throw notAPicture();
  const end = 8 + b.readUInt32LE(4);
  if (end > b.length) throw notAPicture();
  const out: Buffer[] = [Buffer.from(b.subarray(0, 12))];
  let at = 12;
  while (at < end) {
    if (at + 8 > end) throw notAPicture();
    const length = b.readUInt32LE(at + 4);
    const dataEnd = at + 8 + length;
    if (dataEnd > end) throw notAPicture();
    const chunkEnd = Math.min(end, dataEnd + (length % 2));
    const type = b.toString('latin1', at, at + 4);
    if (!WEBP_DROPPED.has(type)) {
      const chunk = Buffer.from(b.subarray(at, chunkEnd));
      if (type === 'VP8X' && length >= 1) chunk[8] = chunk[8]! & ~(VP8X_EXIF | VP8X_XMP);
      out.push(chunk);
    }
    at = chunkEnd;
  }
  const result = Buffer.concat(out);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}
