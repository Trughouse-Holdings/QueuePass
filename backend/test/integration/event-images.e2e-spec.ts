import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { asAdmin } from '../setup/authed-request';
import { event, venue } from '../setup/fixtures';
import {
  exifApp1,
  exifTiff,
  iptcApp13,
  JPEG,
  jpegMarkers,
  jpegSegment,
  jpegWith,
  minimalExifApp1,
  orientationApp1,
  padded,
  PNG,
  pngChunk,
  pngOf,
  sosAt,
  upload,
  vp8x,
  WEBP,
  WEBP_VP8L,
  webpChunk,
  webpOf,
  xmpApp1,
} from '../setup/images';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';

/**
 * Spec 014 US1 (FR-003 to FR-006, FR-013, FR-035 to FR-037; research R3, R4, R17): adding an
 * image and reading it back, through the contract-checking client.
 */
describe('Event images: upload and read', () => {
  let ctx: TestContext;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    eventId = await event(ctx, await venue(ctx), { name: 'Season Opener' });
  });

  const rows = () =>
    ctx.prisma.eventImage.findMany({ where: { eventId }, orderBy: { position: 'asc' } });
  const stored = async (): Promise<Buffer> => {
    const [row] = await rows();
    return Buffer.from(row!.bytes);
  };
  /** Supertest buffers an image/* body as a Buffer. */
  const read = (imageId: string, forEvent = eventId) =>
    asAdmin(ctx).get(`/events/${forEvent}/images/${imageId}`);
  const refused = async (bytes: Buffer, status: number, code: string) => {
    const res = await upload(ctx, eventId, bytes).expect(status);
    expect(res.body.error.code).toBe(code);
    expect(await rows()).toEqual([]);
    return res;
  };

  describe('accepted pictures', () => {
    it('adds a JPEG, a PNG, and a WebP at positions 1, 2, 3 with their detected types', async () => {
      const added = [];
      for (const [bytes, type] of [
        [JPEG, 'image/jpeg'],
        [PNG, 'image/png'],
        [WEBP, 'image/webp'],
      ] as const) {
        const res = await upload(ctx, eventId, bytes).expect(201);
        expect(res.body).toEqual({
          id: expect.any(String),
          position: added.length + 1,
          contentType: type,
          byteSize: bytes.length,
        });
        added.push(res.body);
      }
      const got = await asAdmin(ctx).get(`/events/${eventId}`).expect(200);
      expect(got.body.images).toEqual(added);
    });

    it('decides the type by content: PNG bytes named photo.jpg as image/jpeg are a PNG', async () => {
      const res = await upload(ctx, eventId, PNG, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      }).expect(201);
      expect(res.body.contentType).toBe('image/png');
      const img = await read(res.body.id).expect(200);
      expect(img.headers['content-type']).toBe('image/png');
    });
  });

  describe('refused types (FR-003, FR-037)', () => {
    it('refuses text named poster.jpg sent as image/jpeg with 415 and details.allowed', async () => {
      const res = await upload(ctx, eventId, Buffer.from('not a picture, honestly\n'), {
        filename: 'poster.jpg',
        contentType: 'image/jpeg',
      }).expect(415);
      expect(res.body.error).toEqual({
        code: 'IMAGE_TYPE_NOT_ALLOWED',
        message: 'This file is not a JPG, PNG, or WebP picture.',
        details: { allowed: ['image/jpeg', 'image/png', 'image/webp'] },
      });
      expect(await rows()).toEqual([]);
    });

    it('refuses a GIF', async () => {
      await refused(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'), 415, 'IMAGE_TYPE_NOT_ALLOWED');
    });

    it('refuses an animated PNG (acTL)', async () => {
      const apng = pngOf(2, 2, {
        before: [pngChunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]))],
      });
      await refused(apng, 415, 'IMAGE_TYPE_NOT_ALLOWED');
    });

    it('refuses an animated WebP (VP8X flag 0x02 with ANIM and ANMF)', async () => {
      const anim = webpOf([
        vp8x(0x02, 1, 1),
        webpChunk('ANIM', Buffer.alloc(6)),
        webpChunk('ANMF', Buffer.concat([Buffer.alloc(16), WEBP_VP8L])),
      ]);
      await refused(anim, 415, 'IMAGE_TYPE_NOT_ALLOWED');
    });

    it('refuses a PNG whose IHDR is cut short', async () => {
      await refused(PNG.subarray(0, 20), 415, 'IMAGE_TYPE_NOT_ALLOWED');
    });

    it('refuses a PNG whose later chunk runs past the end of the file', async () => {
      const broken = Buffer.concat([
        pngOf().subarray(0, 33),
        Buffer.from([0, 0, 0, 99]),
        Buffer.from('IDAT'),
      ]);
      await refused(broken, 415, 'IMAGE_TYPE_NOT_ALLOWED');
    });
    it('refuses a picture too large in pixels whose chunks run past the end with 415, as the contract orders (M3)', async () => {
      const broken = Buffer.concat([
        pngOf(20_000, 20_000).subarray(0, 33),
        Buffer.from([0, 0, 0, 99]),
        Buffer.from('IDAT'),
      ]);
      await refused(broken, 415, 'IMAGE_TYPE_NOT_ALLOWED');
    });
  });

  describe('size in bytes (FR-004)', () => {
    it('accepts exactly 5,242,880 bytes', async () => {
      const res = await upload(ctx, eventId, padded(PNG, 5_242_880)).expect(201);
      expect(res.body.byteSize).toBe(5_242_880);
    });

    it('accepts a 5,242,880-byte JPEG whose only Exif is a 32-byte orientation (M2)', async () => {
      const target = 5_242_880;
      const base = jpegWith([minimalExifApp1(6)]);
      // Kept APP3 segments fill the rest; each is at most 65,537 bytes.
      const remaining = target - base.length;
      const n = Math.ceil(remaining / 65_537);
      const fill = Array.from({ length: n }, (_, i) => {
        const size = Math.floor(remaining / n) + (i < remaining % n ? 1 : 0);
        return jpegSegment(0xe3, Buffer.alloc(size - 4, 0x2a));
      });
      const original = jpegWith([minimalExifApp1(6), ...fill]);
      expect(original.length).toBe(target);
      const res = await upload(ctx, eventId, original).expect(201);
      expect(res.body.byteSize).toBeLessThanOrEqual(target);
      const bytes = await stored();
      expect(bytes.length).toBe(res.body.byteSize);
      expect(bytes.subarray(2, 34)).toEqual(
        Buffer.concat([Buffer.from([0xff, 0xe1, 0, 30]), orientationApp1(6).subarray(4, 32)]),
      );
    });

    it('refuses 5,242,881 bytes with 413 IMAGE_TOO_LARGE and details.maxBytes', async () => {
      const res = await refused(padded(PNG, 5_242_881), 413, 'IMAGE_TOO_LARGE');
      expect(res.body.error).toEqual({
        code: 'IMAGE_TOO_LARGE',
        message: 'An image can be at most 5 MB.',
        details: { maxBytes: 5242880 },
      });
    });
  });

  describe('size in pixels (FR-036)', () => {
    it('accepts 16,384 × 2,441 pixels', async () => {
      await upload(ctx, eventId, pngOf(16_384, 2_441)).expect(201);
    });

    it('refuses 16,385 × 1 pixels with 400 IMAGE_DIMENSIONS_TOO_LARGE', async () => {
      const res = await refused(pngOf(16_385, 1), 400, 'IMAGE_DIMENSIONS_TOO_LARGE');
      expect(res.body.error.details).toEqual({
        width: 16385,
        height: 1,
        maxSide: 16384,
        maxPixels: 40000000,
      });
    });

    it('accepts 16,384 × 1 pixels (the side limit, other side)', async () => {
      await upload(ctx, eventId, pngOf(16_384, 1)).expect(201);
    });

    it('refuses 7,000 × 7,000 pixels (49 megapixels), and accepts 6,000 × 6,000', async () => {
      const res = await refused(pngOf(7_000, 7_000), 400, 'IMAGE_DIMENSIONS_TOO_LARGE');
      expect(res.body.error.message).toBe(
        'This picture is 7000 × 7000 pixels. A picture can be at most 16,384 pixels on each side and 40 megapixels in all.',
      );
      await upload(ctx, eventId, pngOf(6_000, 6_000)).expect(201);
    });
  });

  describe('the request shape (400 VALIDATION_FAILED)', () => {
    const shapes: [string, () => request.Test][] = [
      [
        'no file part',
        () =>
          asAdmin(ctx)
            .post(`/events/${eventId}/images`)
            .attach('picture', PNG, { filename: 'a.png', contentType: 'image/png' }),
      ],
      ['a JSON body', () => asAdmin(ctx).post(`/events/${eventId}/images`).send({ file: 'x' })],
      [
        'two file parts',
        () =>
          asAdmin(ctx)
            .post(`/events/${eventId}/images`)
            .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
            .attach('file', PNG, { filename: 'b.png', contentType: 'image/png' }),
      ],
      [
        'a file plus another field',
        () =>
          asAdmin(ctx)
            .post(`/events/${eventId}/images`)
            .field('caption', 'hello')
            .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }),
      ],
    ];
    it.each(shapes)('refuses %s', async (_name, send) => {
      const res = await send().expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await rows()).toEqual([]);
    });
  });

  describe('the event', () => {
    it('404s an unknown event', async () => {
      const res = await upload(ctx, randomUUID(), PNG).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('400s a malformed event id', async () => {
      const res = await upload(ctx, 'not-a-uuid', PNG).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a cancelled event with 409 EVENT_CANCELLED', async () => {
      await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
      await refused(PNG, 409, 'EVENT_CANCELLED');
    });

    it('refuses a sixth image with 409 IMAGE_LIMIT_REACHED, keeping 5', async () => {
      for (let i = 0; i < 5; i++) await upload(ctx, eventId, PNG).expect(201);
      const res = await upload(ctx, eventId, PNG).expect(409);
      expect(res.body.error).toEqual({
        code: 'IMAGE_LIMIT_REACHED',
        message:
          'Season Opener already has 5 images, the most an event can have. Remove one to add another.',
        details: { limit: 5, count: 5 },
      });
      expect((await rows()).map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('metadata removal (FR-035; research R17)', () => {
    it('keeps only a JPEG orientation of 6, dropping Exif GPS and make, XMP, and APP13', async () => {
      const original = jpegWith([
        exifApp1({ orientation: 6, make: 'SecretCamCo', gps: 'GPS-38.2527N-85.7585W' }),
        xmpApp1('<x:xmpmeta>xmp-secret</x:xmpmeta>'),
        iptcApp13('iptc-secret'),
      ]);
      const res = await upload(ctx, eventId, original).expect(201);
      const bytes = await stored();
      for (const secret of ['GPS-38', 'SecretCamCo', 'xmp-secret', 'Photoshop', 'iptc-secret'])
        expect(bytes.includes(Buffer.from(secret))).toBe(false);
      expect(jpegMarkers(bytes).filter((m) => m === 0xe1)).toHaveLength(1);
      expect(bytes.subarray(2, 2 + 36)).toEqual(orientationApp1(6));
      expect(bytes.subarray(sosAt(bytes))).toEqual(original.subarray(sosAt(original)));
      expect(res.body.byteSize).toBe(bytes.length);
    });

    it('writes no Exif segment for a JPEG with orientation 1', async () => {
      await upload(ctx, eventId, jpegWith([exifApp1({ orientation: 1, make: 'Cam' })])).expect(201);
      expect(jpegMarkers(await stored())).not.toContain(0xe1);
    });

    it('drops PNG eXIf, tEXt, iTXt, and zTXt, keeping the other chunks', async () => {
      const original = pngOf(2, 2, {
        before: [
          pngChunk('eXIf', exifTiff({ make: 'SecretCamCo' })),
          pngChunk('tEXt', Buffer.from('Comment\0text-secret')),
          pngChunk('iTXt', Buffer.from('Comment\0\0\0\0\0itxt-secret')),
          pngChunk('zTXt', Buffer.from('Comment\0\0ztxt-secret')),
        ],
      });
      await upload(ctx, eventId, original).expect(201);
      expect(await stored()).toEqual(pngOf(2, 2));
    });

    it('drops WebP EXIF and XMP chunks, clears both VP8X flags, and rewrites the RIFF size', async () => {
      const original = webpOf([
        vp8x(0x08 | 0x04, 1, 1),
        WEBP_VP8L,
        webpChunk('EXIF', exifTiff({ make: 'SecretCamCo' })),
        webpChunk('XMP ', Buffer.from('<x:xmpmeta>xmp-secret</x:xmpmeta>')),
      ]);
      await upload(ctx, eventId, original).expect(201);
      const bytes = await stored();
      expect(bytes).toEqual(webpOf([vp8x(0, 1, 1), WEBP_VP8L]));
      expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    });
  });

  describe('reading an image (getEventImage; research R4)', () => {
    it('returns the bytes exactly, with the stored type and the caching headers', async () => {
      const res = await upload(ctx, eventId, WEBP).expect(201);
      const img = await read(res.body.id).expect(200);
      expect(img.body).toEqual(WEBP);
      expect(img.headers['content-type']).toBe('image/webp');
      expect(img.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(img.headers['x-content-type-options']).toBe('nosniff');
      expect(img.headers['content-length']).toBe(String(WEBP.length));
    });

    it("404s another event's image under this event's path", async () => {
      const other = await event(ctx, await venue(ctx, 'Other Hall'), { name: 'Other' });
      const res = await upload(ctx, other, PNG).expect(201);
      const img = await read(res.body.id).expect(404);
      expect(img.body.error.code).toBe('NOT_FOUND');
    });

    it('404s an unknown image id', async () => {
      await read(randomUUID()).expect(404);
    });
  });
});
