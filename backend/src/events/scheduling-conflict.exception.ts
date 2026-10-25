import { HttpException, HttpStatus } from '@nestjs/common';
import type { Event } from '@prisma/client';
import { SCHEDULING_BUFFER_MINUTES, formatEventEnd, formatEventTime } from '@queuepass/shared';

type EventTimes = Pick<Event, 'id' | 'name' | 'startsAt' | 'endsAt'>;

const ref = (e: EventTimes) => ({
  id: e.id,
  name: e.name,
  startsAt: e.startsAt.toISOString(),
  endsAt: e.endsAt.toISOString(),
});

/**
 * 409 SCHEDULING_CONFLICT carrying the event responsible (FR-027).
 *
 * Raised by the service-layer pre-check, which can identify the conflicting row. The
 * database constraint firing on a race produces the same code with conflictingEvent: null
 * — see AllExceptionsFilter.
 *
 * Spec 020 FR-022 (research R9): the message gives the conflicting event's times in the venue's
 * local time with the zone's abbreviation, the end with its own date only when it differs. A zone
 * change's pre-check (R8) passes `message` and the later event of the pair as `event`.
 */
export class SchedulingConflictException extends HttpException {
  constructor(
    conflicting: EventTimes,
    zone: string,
    second?: { event: EventTimes; message: string },
  ) {
    super(
      {
        error: {
          code: 'SCHEDULING_CONFLICT',
          message:
            second?.message ??
            `This venue is already committed from ${formatEventTime(conflicting.startsAt, zone)} ` +
              `to ${formatEventEnd(conflicting.startsAt, conflicting.endsAt, zone)} by ` +
              `'${conflicting.name}'. Events at the same venue must be at least ` +
              `${SCHEDULING_BUFFER_MINUTES} minutes apart.`,
          details: {
            bufferMinutes: SCHEDULING_BUFFER_MINUTES,
            conflictingEvent: ref(conflicting),
            ...(second ? { event: ref(second.event) } : {}),
          },
        },
      },
      HttpStatus.CONFLICT,
    );
  }
}
