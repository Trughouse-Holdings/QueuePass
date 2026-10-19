import { crc32, deflateSync } from 'node:zlib';

/** One color as red, green, and blue, 0 to 255. */
export type Rgb = readonly [number, number, number];

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/** One PNG chunk: its length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * Spec 014 FR-034 (research R15): a PNG of `width` × `height` pixels in broad diagonal bands of
 * two colors, made at run time so no picture file is committed and none is copyrighted. 8-bit
 * RGB, no filter; the repeating rows compress to a few kilobytes.
 */
export function demoPng(width: number, height: number, colors: readonly [Rgb, Rgb]): Buffer {
  const band = Math.max(1, Math.round(width / 8));
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colors[Math.floor((x + y) / band) % 2]!;
      const at = y * row + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
