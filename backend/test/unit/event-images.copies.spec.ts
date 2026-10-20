import type { Response } from 'express';
import { EventImagesController } from '../../src/events/event-images.controller';
import { EventImagesService } from '../../src/events/event-images.service';
import * as metadata from '../../src/events/image-metadata';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { PNG } from '../setup/images';

/**
 * Spec 014, review of PR #63: an image's bytes are not copied on their way to the database or to
 * the response, beyond the copy that removing metadata makes (research R17).
 */
afterEach(() => jest.restoreAllMocks());

describe('event image bytes, without extra copies', () => {
  it('sends the stripped bytes to the database as they are', async () => {
    const strip = jest.spyOn(metadata, 'stripImageMetadata');
    let stored: unknown;
    const tx = {
      $queryRaw: async () => [{ id: 'e1', name: 'Season Opener', status: 'SCHEDULED' }],
      eventImage: {
        count: async () => 0,
        create: async (args: { data: { bytes: unknown } }) => {
          stored = args.data.bytes;
          return { id: 'i1', position: 1, contentType: 'image/png', byteSize: PNG.length };
        },
      },
    };
    const prisma = {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as unknown as PrismaService;

    await new EventImagesService(prisma).add('e1', { buffer: PNG, size: PNG.length });
    expect(strip).toHaveBeenCalledTimes(1);
    expect(stored).toBe(strip.mock.results[0]!.value);
  });

  it('streams the stored bytes from the same memory', async () => {
    const bytes = new Uint8Array(new ArrayBuffer(64), 8, 32).fill(7);
    const service = {
      read: async () => ({ contentType: 'image/png', bytes }),
    } as unknown as EventImagesService;
    const res = { setHeader: () => res } as unknown as Response;

    const file = await new EventImagesController(service).read('e1', 'i1', res);
    const chunk = file.getStream().read() as Buffer;
    expect(chunk.buffer).toBe(bytes.buffer);
    expect(chunk.byteOffset).toBe(8);
    expect(chunk.length).toBe(32);
    expect(file.getHeaders().length).toBe(32);
  });
});
