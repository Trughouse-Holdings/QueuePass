import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@queuepass/shared';

/** A 409 in the standard envelope (contracts/openapi.yaml `Conflict`). */
export function conflict(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException(
    { error: { code, message, ...(details ? { details } : {}) } },
    HttpStatus.CONFLICT,
  );
}

/** Spec 005 FR-009: a cancelled event is read-only. */
export const eventCancelled = (name: string): HttpException =>
  conflict('EVENT_CANCELLED', `${name} is cancelled and can no longer be changed or sold.`);
