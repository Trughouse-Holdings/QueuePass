import { ArgumentsHost, HttpException, PayloadTooLargeException } from '@nestjs/common';
import { EventImagesService } from '../../src/events/event-images.service';
import { ImageTooLargeFilter } from '../../src/events/image-too-large.filter';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Spec 014 research R3, review of PR #63: the image upload answers its own 413s with
 * IMAGE_TOO_LARGE, multer's through a filter on that route only, the service's by throwing the
 * envelope; the global filter no longer turns every 413 into it.
 */
const IMAGE_TOO_LARGE = {
  error: {
    code: 'IMAGE_TOO_LARGE',
    message: 'An image can be at most 5 MB.',
    details: { maxBytes: 5242880 },
  },
};

describe('IMAGE_TOO_LARGE on the image upload', () => {
  it("maps multer's file-size refusal (a PayloadTooLargeException) to the envelope", () => {
    const out = { status: 0, body: undefined as unknown };
    const response = {
      status(code: number) {
        out.status = code;
        return response;
      },
      json(body: unknown) {
        out.body = body;
        return response;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new ImageTooLargeFilter().catch(new PayloadTooLargeException('File too large'), host);
    expect(out).toEqual({ status: 413, body: IMAGE_TOO_LARGE });
  });

  it('is thrown as the envelope by the service for a file over 5 MB', async () => {
    const service = new EventImagesService({} as PrismaService);
    const big = { buffer: Buffer.alloc(0), size: 5_242_881 };
    const thrown = await service.add('e1', big).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(413);
    expect((thrown as HttpException).getResponse()).toEqual(IMAGE_TOO_LARGE);
  });
});
