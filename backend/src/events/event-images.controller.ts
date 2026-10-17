import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EVENT_IMAGE_LIMITS, type EventImage } from '@queuepass/shared';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { EventImagesService, type UploadedImage } from './event-images.service';

/** Implements the /events/{id}/images operations in contracts/openapi.yaml (spec 014). */
@Controller('events/:id/images')
export class EventImagesController {
  constructor(private readonly images: EventImagesService) {}

  /**
   * One `file` part and nothing else, read into memory (multer keeps files in memory when no
   * storage or destination is given), stopped past 5 MB with a 413 (research R3). Guards run
   * before the interceptor, so 401 and 403 come before the body is read.
   */
  @Post()
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
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
    return new StreamableFile(Buffer.from(bytes), { type: contentType, length: bytes.length });
  }
}
