import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { ErrorEnvelope, ErrorCode } from '@queuepass/shared';
import { SCHEDULING_BUFFER_MINUTES, isErrorEnvelope } from '@queuepass/shared';

/** PostgreSQL SQLSTATE for an exclusion constraint violation. */
const PG_EXCLUSION_VIOLATION = '23P01';
/** PostgreSQL SQLSTATE for a detected deadlock. */
const PG_DEADLOCK = '40P01';

function envelope(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/**
 * Maps every thrown error to the single envelope shape declared in contracts/openapi.yaml.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Envelopes thrown by our own services pass through untouched.
      //
      // The check must confirm `error` is an OBJECT carrying a known `code` — not merely
      // that an `error` key exists. Nest's built-in exceptions also set `error`, but to a
      // STRING ("Bad Request", "Not Found"), and a bare key check passes those straight
      // through, so clients receive Nest's shape instead of the declared envelope.
      if (isErrorEnvelope(body)) {
        response.status(status).json(body);
        return;
      }

      // ValidationPipe and Parse*Pipe failures arrive as { statusCode, message, error }.
      const raw = body as { message?: string | string[] };
      const messages = raw?.message
        ? Array.isArray(raw.message)
          ? raw.message
          : [raw.message]
        : [exception.message];

      // Spec 001 research R13: authentication and authorization failures have their own codes.
      // Without these branches they would fall through to the fallback below and reach
      // clients as VALIDATION_FAILED. The 401 message never says which check failed.
      if (status === HttpStatus.UNAUTHORIZED) {
        response
          .status(status)
          .setHeader('WWW-Authenticate', 'Bearer')
          .json(envelope('UNAUTHENTICATED', 'A valid access token is required.'));
        return;
      }

      if (status === HttpStatus.FORBIDDEN) {
        const requiredRoles = (body as { requiredRoles?: unknown }).requiredRoles;
        response
          .status(status)
          .json(
            envelope(
              'FORBIDDEN',
              messages.join(' '),
              Array.isArray(requiredRoles) ? { requiredRoles } : undefined,
            ),
          );
        return;
      }

      if (status === HttpStatus.BAD_REQUEST) {
        response
          .status(status)
          .json(envelope('VALIDATION_FAILED', 'Request validation failed.', { fields: messages }));
        return;
      }

      if (status === HttpStatus.NOT_FOUND) {
        response.status(status).json(envelope('NOT_FOUND', messages.join(' ')));
        return;
      }

      if (status === HttpStatus.CONFLICT) {
        response.status(status).json(envelope('VENUE_HAS_EVENTS', messages.join(' ')));
        return;
      }

      this.logger.error(`Unmapped HttpException status ${status}: ${messages.join(' ')}`);
      response.status(status).json(envelope('VALIDATION_FAILED', messages.join(' ')));
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        // Foreign-key violation. On a venue delete this is FR-013: the database refuses
        // to orphan events, so no client can bypass the rule.
        // Spec 005: the same RESTRICT protects events and tiers that have orders, so say which.
        case 'P2003': {
          const fk = JSON.stringify(exception.meta ?? {});
          if (/(Order|Ticket)_eventId/.test(fk)) {
            response
              .status(HttpStatus.CONFLICT)
              .json(
                envelope(
                  'EVENT_HAS_ORDERS',
                  'Cannot delete this event; it has orders. Cancel it instead.',
                ),
              );
          } else if (/(Order|Ticket)_tierId/.test(fk)) {
            response
              .status(HttpStatus.CONFLICT)
              .json(envelope('TIER_HAS_ORDERS', 'Cannot remove this tier; it has orders.'));
          } else {
            response
              .status(HttpStatus.CONFLICT)
              .json(
                envelope(
                  'VENUE_HAS_EVENTS',
                  'Cannot delete this venue; events are still scheduled at it.',
                ),
              );
          }
          return;
        }
        // Unique violation. The only unique index a client can trip is the tier name index
        // (spec 004 research R3), reached when a concurrent insert beat the service's check.
        case 'P2002':
          response
            .status(HttpStatus.CONFLICT)
            .json(
              envelope(
                'TIER_NAME_TAKEN',
                'Another tier of this event already has that name. Choose a different name.',
              ),
            );
          return;
        // Record required but not found (update/delete of a missing row).
        case 'P2025':
          response
            .status(HttpStatus.NOT_FOUND)
            .json(envelope('NOT_FOUND', 'The requested resource does not exist.'));
          return;
      }
    }

    // Raw PostgreSQL errors surface through Prisma as PrismaClientUnknownRequestError.
    // 23P01 is the event_no_overlap exclusion constraint firing — see T069 for why this
    // path exists separately from the service-layer pre-check.
    // A deadlock that survived the service's retries (events.service retryOnDeadlock). On Event
    // writes the only contention is the exclusion index, so it is the same race as 23P01.
    if (this.isExclusionViolation(exception) || this.isDeadlock(exception)) {
      response
        .status(HttpStatus.CONFLICT)
        .json(
          envelope(
            'SCHEDULING_CONFLICT',
            'This venue was committed for an overlapping window by another request. Reload and try again.',
            { bufferMinutes: SCHEDULING_BUFFER_MINUTES, conflictingEvent: null },
          ),
        );
      return;
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : exception,
    );
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(envelope('VALIDATION_FAILED', 'An unexpected error occurred.'));
  }

  private isDeadlock(exception: unknown): boolean {
    return exception instanceof Error && exception.message.includes(PG_DEADLOCK);
  }

  private isExclusionViolation(exception: unknown): boolean {
    if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      (exception.meta as { code?: string } | undefined)?.code === PG_EXCLUSION_VIOLATION
    ) {
      return true;
    }
    const message =
      exception instanceof Error
        ? exception.message
        : typeof exception === 'string'
          ? exception
          : '';
    return message.includes(PG_EXCLUSION_VIOLATION) || message.includes('event_no_overlap');
  }
}
