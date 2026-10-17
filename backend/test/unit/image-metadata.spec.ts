import { HttpException } from '@nestjs/common';
import { stripImageMetadata } from '../../src/events/image-metadata';
import {
  exifApp1,
  exifTiff,
  iptcApp13,
  JFIF_APP0,
  JPEG,
  jpegMarkers,
  jpegSegment,
  jpegWith,
  orientationApp1,
  PNG,
  pngChunk,
  pngOf,
  sosAt,
  vp8x,
  WEBP,
  WEBP_VP8L,
  webpChunk,
  webpOf,
  xmpApp1,
} from '../setup/images';

/** Spec 014 FR-035; research R17: metadata removal on hand-built files. */
type Type = 'image/jpeg' | 'image/png' | 'image/webp';
const strip = (b: Buffer, type: Type) => Buffer.from(stripImageMetadata(b, type));

const expect415 = (b: Buffer, type: Type) => {
  let thrown: unknown;
  try {
    stripImageMetadata(b, type);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(HttpException);
  const ex = thrown as HttpException;
  expect(ex.getStatus()).toBe(415);
  expect(ex.getResponse()).toEqual({
    error: {
      code: 'IMAGE_TYPE_NOT_ALLOWED',
      message: 'This file is not a JPG, PNG, or WebP picture.',
      details: { allowed: ['image/jpeg', 'image/png', 'image/webp'] },
    },
  });
};

describe('stripImageMetadata: JPEG', () => {
  it('leaves a JPEG without metadata unchanged', () => {
    expect(strip(JPEG, 'image/jpeg')).toEqual(JPEG);
  });

  it('keeps only orientation 6, right after SOI, and the scan byte for byte', () => {
    const original = jpegWith([
      exifApp1({ orientation: 6, make: 'SecretCamCo', gps: 'GPS-SECRET' }),
      xmpApp1('xmp-secret'),
      iptcApp13('iptc-secret'),
    ]);
    const out = strip(original, 'image/jpeg');
    expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(out.subarray(2, 38)).toEqual(orientationApp1(6));
    for (const s of ['SecretCamCo', 'GPS-SECRET', 'xmp-secret', 'iptc-secret'])
      expect(out.includes(Buffer.from(s))).toBe(false);
    expect(out.subarray(sosAt(out))).toEqual(original.subarray(sosAt(original)));
    expect(out).toEqual(jpegWith([orientationApp1(6)]));
  });

  it('places the orientation segment after a JFIF APP0', () => {
    const out = strip(jpegWith([exifApp1({ orientation: 8 })], { jfif: true }), 'image/jpeg');
    expect(out.subarray(2, 20)).toEqual(JFIF_APP0);
    expect(out.subarray(20, 56)).toEqual(orientationApp1(8));
  });

  it('reads little-endian and big-endian Exif', () => {
    for (const littleEndian of [true, false]) {
      const out = strip(jpegWith([exifApp1({ orientation: 3, littleEndian })]), 'image/jpeg');
      expect(out).toEqual(jpegWith([orientationApp1(3)]));
    }
  });

  it('writes nothing for orientation 1 or no orientation', () => {
    expect(strip(jpegWith([exifApp1({ orientation: 1, make: 'X' })]), 'image/jpeg')).toEqual(
      jpegWith([]),
    );
    expect(strip(jpegWith([exifApp1({ make: 'X' })]), 'image/jpeg')).toEqual(jpegWith([]));
  });

  it('drops extended XMP, APP2 MPF, and COM, and keeps other APPn segments', () => {
    const icc = jpegSegment(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01profile', 'latin1'));
    const out = strip(
      jpegWith([
        xmpApp1('ext-secret', true),
        jpegSegment(0xe2, Buffer.from('MPF\0mpf-secret', 'latin1')),
        jpegSegment(0xfe, Buffer.from('comment-secret')),
        icc,
      ]),
      'image/jpeg',
    );
    expect(out).toEqual(jpegWith([icc]));
  });

  it('walks fill bytes before a marker and a standalone TEM before SOS', () => {
    const comment = jpegSegment(0xfe, Buffer.from('comment'));
    const original = Buffer.concat([
      JPEG.subarray(0, 2),
      Buffer.from([0xff, 0xff]), // fill bytes; the comment segment brings the marker's own 0xFF
      comment,
      Buffer.from([0xff, 0x01]), // TEM, no length
      JPEG.subarray(2),
    ]);
    const out = strip(original, 'image/jpeg');
    expect(out.includes(Buffer.from('comment'))).toBe(false);
    expect(jpegMarkers(out)).not.toContain(0xfe);
    expect(out.subarray(sosAt(out))).toEqual(original.subarray(sosAt(original)));
  });

  it('copies restart markers and stuffed FF 00 bytes in the scan unchanged', () => {
    const sos = sosAt(JPEG);
    const scan = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd7, 0x78]);
    const original = Buffer.concat([JPEG.subarray(0, sos + 10), scan, Buffer.from([0xff, 0xd9])]);
    expect(strip(original, 'image/jpeg')).toEqual(original);
  });

  it('continues through the segments and scans of a progressive picture', () => {
    const sos = sosAt(JPEG);
    const sosSegment = JPEG.subarray(sos, sos + 10);
    const dht = jpegSegment(0xc4, Buffer.alloc(17));
    const head = JPEG.subarray(0, sos);
    const original = Buffer.concat([
      head,
      sosSegment,
      Buffer.from([1, 2, 3]),
      dht,
      jpegSegment(0xfe, Buffer.from('mid-comment')),
      sosSegment,
      Buffer.from([4, 5]),
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(strip(original, 'image/jpeg')).toEqual(
      Buffer.concat([
        head,
        sosSegment,
        Buffer.from([1, 2, 3]),
        dht,
        sosSegment,
        Buffer.from([4, 5]),
        Buffer.from([0xff, 0xd9]),
      ]),
    );
  });

  it('ends at the first EOI, dropping a second JPEG with its own Exif GPS', () => {
    const second = jpegWith([exifApp1({ gps: 'SECOND-GPS' })]);
    expect(strip(jpegWith([], { trailing: second }), 'image/jpeg')).toEqual(jpegWith([]));
  });

  it('refuses a segment length past the end of the file', () => {
    expect415(
      Buffer.concat([JPEG.subarray(0, 2), Buffer.from([0xff, 0xe1, 0x10, 0x00, 1])]),
      'image/jpeg',
    );
  });
});

describe('stripImageMetadata: PNG', () => {
  it('leaves a PNG without metadata unchanged', () => {
    expect(strip(PNG, 'image/png')).toEqual(PNG);
  });

  it('drops eXIf, tEXt, iTXt, zTXt, and tIME, keeping the other chunks', () => {
    const keep = pngChunk('pHYs', Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]));
    const original = pngOf(2, 2, {
      before: [
        pngChunk('eXIf', exifTiff({ make: 'SecretCamCo' })),
        keep,
        pngChunk('tEXt', Buffer.from('Comment\0secret')),
        pngChunk('iTXt', Buffer.from('Comment\0\0\0\0\0secret')),
        pngChunk('zTXt', Buffer.from('Comment\0\0secret')),
      ],
      after: [pngChunk('tIME', Buffer.from([7, 234, 10, 12, 1, 2, 3]))],
    });
    expect(strip(original, 'image/png')).toEqual(pngOf(2, 2, { before: [keep] }));
  });

  it('drops bytes after IEND', () => {
    expect(strip(pngOf(2, 2, { trailing: Buffer.from('trailing-secret') }), 'image/png')).toEqual(
      PNG,
    );
  });

  it('refuses a chunk length past the end of the file', () => {
    expect415(
      Buffer.concat([PNG.subarray(0, 33), Buffer.from([0, 0, 0, 99]), Buffer.from('IDAT')]),
      'image/png',
    );
  });
});

describe('stripImageMetadata: WebP', () => {
  it('leaves a WebP without metadata unchanged', () => {
    expect(strip(WEBP, 'image/webp')).toEqual(WEBP);
  });

  it('drops EXIF and XMP chunks, clears both VP8X flags, and rewrites the RIFF size', () => {
    const original = webpOf([
      vp8x(0x10 | 0x08 | 0x04, 1, 1),
      webpChunk('EXIF', exifTiff({ make: 'SecretCamCo' })),
      WEBP_VP8L,
      webpChunk('XMP ', Buffer.from('xmp-secret')),
    ]);
    const out = strip(original, 'image/webp');
    expect(out).toEqual(webpOf([vp8x(0x10, 1, 1), WEBP_VP8L]));
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
  });

  it('drops bytes past the declared RIFF length', () => {
    expect(strip(webpOf([WEBP_VP8L], Buffer.from('trailing-secret')), 'image/webp')).toEqual(WEBP);
  });

  it('refuses a chunk length past the end of the file', () => {
    const broken = webpOf([
      Buffer.concat([Buffer.from('VP8L'), Buffer.from([99, 0, 0, 0]), Buffer.alloc(4)]),
    ]);
    expect415(broken, 'image/webp');
  });
});
