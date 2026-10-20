import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EVENT_IMAGE_LIMITS,
  IMAGE_PIXEL_LIMITS,
  readImageHeader,
  type EventImage,
  type ImageContentType,
} from '@queuepass/shared';
import { conflict, eventCancelled } from '../common/conflict';
import { LOCKING_TX, lockEvent } from '../common/event-lock';
import { PrismaService } from '../prisma/prisma.service';
import { notAPicture, stripImageMetadata } from './image-metadata';
import { imageTooLarge } from './image-too-large.filter';

/** The part of multer's file object this service reads; avoids a dependency on @types/multer. */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

const imageNotFound = (eventId: string, imageId: string) =>
  new NotFoundException(`No image ${imageId} exists for event ${eventId}.`);

/** Metadata only: `bytes` is selected in `read` and nowhere else (research R6). */
const IMAGE_SELECT = { id: true, position: true, contentType: true, byteSize: true } as const;

/**
 * Spec 014: an event's images (data-model.md "Writes"; research R2, R3, R17). Every write is one
 * transaction that starts with the event's row lock, after the upload has been read and checked,
 * so the lock is held only for the insert.
 */
@Injectable()
export class EventImagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** FR-003 to FR-006, FR-035 to FR-037: adds one picture after the event's existing images. */
  async add(eventId: string, file: UploadedImage | undefined): Promise<EventImage> {
    if (!file) {
      throw new BadRequestException({ message: ['Send exactly one file, in a part named file.'] });
    }
    // Multer stops at the limit while reading; this is the same rule, checked again.
    if (file.size > EVENT_IMAGE_LIMITS.maxBytes) throw imageTooLarge();

    const header = readImageHeader(file.buffer);
    if (!header || header.animated) throw notAPicture();
    // The contract's refusal order: a structure that cannot be walked (415) before the pixel limits
    // (400). Stripping reads the whole file but holds no lock.
    const bytes = stripImageMetadata(file.buffer, header.contentType);
    const { width, height } = header;
    const { maxSide, maxPixels } = IMAGE_PIXEL_LIMITS;
    if (width > maxSide || height > maxSide || width * height > maxPixels) {
      throw new HttpException(
        {
          error: {
            code: 'IMAGE_DIMENSIONS_TOO_LARGE',
            message:
              `This picture is ${width} × ${height} pixels. A picture can be at most 16,384 ` +
              'pixels on each side and 40 megapixels in all.',
            details: { width, height, maxSide, maxPixels },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      if (event.status === 'CANCELLED') throw eventCancelled(event.name);
      const count = await tx.eventImage.count({ where: { eventId } });
      if (count >= EVENT_IMAGE_LIMITS.maxCount) {
        throw conflict(
          'IMAGE_LIMIT_REACHED',
          `${event.name} already has ${EVENT_IMAGE_LIMITS.maxCount} images, the most an event can ` +
            'have. Remove one to add another.',
          { limit: EVENT_IMAGE_LIMITS.maxCount, count },
        );
      }
      const created = await tx.eventImage.create({
        data: {
          eventId,
          position: count + 1,
          contentType: header.contentType,
          byteSize: bytes.length,
          bytes: new Uint8Array(bytes),
        },
        select: IMAGE_SELECT,
      });
      return { ...created, contentType: created.contentType as ImageContentType };
    }, LOCKING_TX);
  }

  /**
   * FR-007, FR-009, FR-010: removes one image and closes the gap, in one statement (the deferrable
   * unique constraint is checked when the statement ends, research R2).
   */
  async remove(eventId: string, imageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      const image = await tx.eventImage.findFirst({
        where: { id: imageId, eventId },
        select: { position: true },
      });
      if (!image) throw imageNotFound(eventId, imageId);
      if (event.status === 'CANCELLED') throw eventCancelled(event.name);
      await tx.eventImage.delete({ where: { id: imageId } });
      await tx.$executeRaw`
        UPDATE "EventImage" SET "position" = "position" - 1
        WHERE "eventId" = ${eventId}::uuid AND "position" > ${image.position}`;
    }, LOCKING_TX);
  }

  /**
   * FR-008 to FR-010: sets the order from a list naming every image of the event exactly once,
   * in one statement. Any other list means the images changed since it was read.
   */
  async reorder(eventId: string, imageIds: string[]): Promise<EventImage[]> {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      if (event.status === 'CANCELLED') throw eventCancelled(event.name);
      const current = (
        await tx.eventImage.findMany({
          where: { eventId },
          select: { id: true },
          orderBy: { position: 'asc' },
        })
      ).map((i) => i.id);
      const wanted = new Set(imageIds);
      if (current.length !== imageIds.length || current.some((id) => !wanted.has(id))) {
        throw conflict(
          'IMAGES_CHANGED',
          `The images of ${event.name} changed since you loaded them. Check them and try again.`,
          { imageIds: current },
        );
      }
      if (imageIds.length > 0) {
        await tx.$executeRaw`
          UPDATE "EventImage" AS i SET "position" = o.ord::int
          FROM unnest(${imageIds}::uuid[]) WITH ORDINALITY AS o(id, ord)
          WHERE i."id" = o.id AND i."eventId" = ${eventId}::uuid`;
      }
      const images = await tx.eventImage.findMany({
        where: { eventId },
        select: IMAGE_SELECT,
        orderBy: { position: 'asc' },
      });
      return images.map((i) => ({ ...i, contentType: i.contentType as ImageContentType }));
    }, LOCKING_TX);
  }

  /** FR-013: one image's bytes and type; an image of another event is not found. */
  async read(
    eventId: string,
    imageId: string,
  ): Promise<{ contentType: ImageContentType; bytes: Uint8Array }> {
    const image = await this.prisma.eventImage.findFirst({
      where: { id: imageId, eventId },
      select: { contentType: true, bytes: true },
    });
    if (!image) throw imageNotFound(eventId, imageId);
    return { contentType: image.contentType as ImageContentType, bytes: image.bytes };
  }
}
