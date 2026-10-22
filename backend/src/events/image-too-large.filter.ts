import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import { EVENT_IMAGE_LIMITS } from '@queuepass/shared';
import type { Response } from 'express';

/** Spec 014 research R3: `413 IMAGE_TOO_LARGE`, as the contract declares for uploadEventImage. */
export const imageTooLarge = (): HttpException =>
  new HttpException(
    {
      error: {
        code: 'IMAGE_TOO_LARGE',
        message: 'An image can be at most 5 MB.',
        details: { maxBytes: EVENT_IMAGE_LIMITS.maxBytes },
      },
    },
    HttpStatus.PAYLOAD_TOO_LARGE,
  );

/**
 * Spec 014 research R3: multer stops reading an upload past 5 MB, and Nest's FileInterceptor turns
 * its `LIMIT_FILE_SIZE` into a `PayloadTooLargeException`. Applied to the image upload only, so
 * a 413 anywhere else keeps the global filter's generic answer (review of PR #63).
 */
@Catch(PayloadTooLargeException)
export class ImageTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const error = imageTooLarge();
    host.switchToHttp().getResponse<Response>().status(error.getStatus()).json(error.getResponse());
  }
}
