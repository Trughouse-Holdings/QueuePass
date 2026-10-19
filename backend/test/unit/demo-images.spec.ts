import { crc32, inflateSync } from 'node:zlib';
import { readImageHeader, sniffImageType } from '@queuepass/shared';
import { demoPng } from '../../src/scripts/demo-images';

/** Spec 014 FR-034 (research R15): the demo pictures are real PNGs, made at run time. */
describe('demoPng', () => {
  const RED: [number, number, number] = [200, 40, 40];
  const BLUE: [number, number, number] = [30, 60, 160];

  /** The chunks after the signature, with their stored CRCs. */
  function chunks(png: Buffer) {
    const out: { type: string; data: Buffer; crc: number; typed: Buffer }[] = [];
    let at = 8;
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      const typed = png.subarray(at + 4, at + 8 + length);
      out.push({
        type: typed.toString('latin1', 0, 4),
        data: typed.subarray(4),
        crc: png.readUInt32BE(at + 8 + length),
        typed,
      });
      at += 12 + length;
    }
    return out;
  }

  it('starts with the PNG signature and has IHDR with the requested size', () => {
    const png = demoPng(960, 540, [RED, BLUE]);
    expect(png.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(sniffImageType(png)).toBe('image/png');
    const [ihdr] = chunks(png);
    expect(ihdr!.type).toBe('IHDR');
    expect(ihdr!.data.readUInt32BE(0)).toBe(960);
    expect(ihdr!.data.readUInt32BE(4)).toBe(540);
    expect(readImageHeader(png)).toEqual({
      contentType: 'image/png',
      width: 960,
      height: 540,
      animated: false,
    });
  });

  it('writes chunks whose CRCs check, ending with IEND', () => {
    const png = demoPng(32, 20, [RED, BLUE]);
    const list = chunks(png);
    expect(list.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const c of list) expect(c.crc).toBe(crc32(c.typed));
  });

  it('holds 8-bit RGB rows of diagonal bands in the two colors', () => {
    const png = demoPng(32, 20, [RED, BLUE]);
    const ihdr = chunks(png)[0]!.data;
    expect([ihdr[8], ihdr[9]]).toEqual([8, 2]); // bit depth 8, RGB
    const raw = inflateSync(chunks(png)[1]!.data);
    expect(raw.length).toBe(20 * (1 + 32 * 3));
    const pixel = (x: number, y: number) => {
      const at = y * (1 + 32 * 3) + 1 + x * 3;
      return [raw[at], raw[at + 1], raw[at + 2]];
    };
    const colors = new Set<string>();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 32; x++) colors.add(pixel(x, y).join());
    expect(colors).toEqual(new Set([RED.join(), BLUE.join()]));
  });

  it('is a few kilobytes at 960 × 540', () => {
    expect(demoPng(960, 540, [RED, BLUE]).length).toBeLessThan(100 * 1024);
  });
});
