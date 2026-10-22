import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EVENT_IMAGE_LIMITS, type EventImage } from '@queuepass/shared';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { ReorderEventImagesDto } from './dto/reorder-event-images.dto';
import { EventImagesService, type UploadedImage } from './event-images.service';
import { ImageTooLargeFilter } from './image-too-large.filter';

/** Implements the /events/{id}/images operations in contracts/openapi.yaml (spec 014). */
@Controller('events/:id/images')
export class EventImagesController {
  constructor(private readonly images: EventImagesService) {}

  /**
   * One `file` part and nothing else, read into memory (multer keeps files in memory when no
   * storage or destination is given), stopped past 5 MB with `413 IMAGE_TOO_LARGE` (research R3;
   * the filter maps multer's refusal on this route only). Guards run before the interceptor, so
   * 401 and 403 come before the body is read.
   */
  @Post()
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(ImageTooLargeFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      // busboy refuses when a count REACHES its limit, not when it passes it. So the file size
      // limit is 5,242,880 + 1 (a file of exactly 5 MB is accepted, FR-004), and there is no
      // `parts` limit (`parts: 1` would refuse every upload; `files: 1` and `fields: 0` already
      // allow exactly one part).
      limits: { fileSize: EVENT_IMAGE_LIMITS.maxBytes + 1, files: 1, fields: 0 },
    }),
  )
  add(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<EventImage> {
    return this.images.add(id, file);
  }

  /** FR-008: the event's images in the order named; declared before `:imageId` routes. */
  @Put('order')
  @Roles('queuepass-admin')
  reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReorderEventImagesDto,
  ): Promise<EventImage[]> {
    return this.images.reorder(id, body.imageIds);
  }

  /** FR-007: removes one image; the others close the gap. */
  @Delete(':imageId')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<void> {
    return this.images.remove(id, imageId);
  }

  /** Any signed-in user, like the event it belongs to (FR-002, FR-013; research R4). */
  @Get(':imageId')
  async read(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { contentType, bytes } = await this.images.read(id, imageId);
    // An image's content never changes: a new picture is a new id.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A Buffer over the same memory: no copy of up to 5 MB per read.
    const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new StreamableFile(body, { type: contentType, length: bytes.length });
  }
}
