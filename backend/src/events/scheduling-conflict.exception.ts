import { HttpException, HttpStatus } from '@nestjs/common';
import type { Event } from '@prisma/client';
import { SCHEDULING_BUFFER_MINUTES } from '@queuepass/shared';

/**
 * 409 SCHEDULING_CONFLICT carrying the event responsible (FR-027).
 *
 * Raised by the service-layer pre-check, which can identify the conflicting row. The
 * database constraint firing on a race produces the same code with conflictingEvent: null
 * — see AllExceptionsFilter.
 */
export class SchedulingConflictException extends HttpException {
  constructor(conflicting: Event) {
    const venueTime = (d: Date): string => d.toISOString().slice(11, 16); // HH:MM in UTC — the message is informational

    super(
      {
        error: {
          code: 'SCHEDULING_CONFLICT',
          message:
            `This venue is already committed from ${venueTime(conflicting.startsAt)} to ` +
            `${venueTime(conflicting.endsAt)} UTC by '${conflicting.name}'. Events at the same ` +
            `venue must be at least ${SCHEDULING_BUFFER_MINUTES} minutes apart.`,
          details: {
            bufferMinutes: SCHEDULING_BUFFER_MINUTES,
            conflictingEvent: {
              id: conflicting.id,
              name: conflicting.name,
              startsAt: conflicting.startsAt.toISOString(),
              endsAt: conflicting.endsAt.toISOString(),
            },
          },
        },
      },
      HttpStatus.CONFLICT,
    );
  }
}
