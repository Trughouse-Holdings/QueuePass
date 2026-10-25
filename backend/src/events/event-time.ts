import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import {
  formatOffset,
  parseOffsetDateTime,
  resolveLocal,
  skippedTimeMessage,
  zoneName,
  type UsTimeZone,
} from '@queuepass/shared';

export type EventTimeField = 'startsAt' | 'endsAt';

/** Spec 020 research R9: the DTO pattern for an RFC 3339 date-time with an offset. */
export const OFFSET_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export const needsOffset = (field: EventTimeField): string =>
  `${field} must include a UTC offset, for example 2026-10-01T19:00:00-04:00`;

const refused = (code: string, message: string, details: object): HttpException =>
  new HttpException({ error: { code, message, details } }, HttpStatus.BAD_REQUEST);

/**
 * Spec 020 FR-018, research R9: an event time must state the venue's local time with the venue's
 * offset at that time. A skipped local time is 400 LOCAL_TIME_SKIPPED; any other offset (`Z`
 * included) is 400 UTC_OFFSET_MISMATCH; for a repeated local time the offset chooses the first
 * or second moment. Returns the instant.
 */
export function checkEventTime(
  field: EventTimeField,
  sent: string,
  zone: UsTimeZone,
  venueName: string,
): Date {
  const parsed = parseOffsetDateTime(sent);
  // The DTO already refuses a time without an offset; this is the same refusal, kept for safety.
  if (!parsed) throw new BadRequestException({ message: [needsOffset(field)] });
  const localTime = parsed.local.slice(0, 16);
  const resolved = resolveLocal(parsed.local, zone);

  if (resolved.kind === 'skipped') {
    throw refused(
      'LOCAL_TIME_SKIPPED',
      skippedTimeMessage(localTime, zone, resolved.skippedFrom, resolved.skippedTo),
      {
        field,
        localTime,
        timeZone: zone,
        skippedFrom: resolved.skippedFrom,
        skippedTo: resolved.skippedTo,
      },
    );
  }

  const moments = resolved.kind === 'ok' ? [resolved.moment] : [resolved.first, resolved.second];
  const sentOffset = formatOffset(parsed.offsetMinutes);
  const match = moments.find((m) => m.offset === sentOffset);
  if (!match) {
    const expectedOffsets = moments.map((m) => m.offset);
    throw refused(
      'UTC_OFFSET_MISMATCH',
      `${field} is stated with offset ${sentOffset}, but ${venueName} is in ${zoneName(zone)}, ` +
        `which is ${expectedOffsets.join(' or ')} at that time. Send the venue's local time ` +
        'with its offset.',
      { field, localTime, timeZone: zone, sentOffset, expectedOffsets },
    );
  }
  return match.instant;
}
