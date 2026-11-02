import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { rateLimitMessage, type RateLimitedAction } from '@queuepass/shared';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/principal';
import { ATTEMPT_LIMIT_KEY } from './attempt-limit.decorator';
import { AttemptLimitsService } from './attempt-limits.service';

/**
 * Spec 026 (FR-003, FR-006, FR-007, FR-009; research R1, R4): the third global guard, after
 * `AuthGuard` and `RolesGuard`, so a caller not signed in or without the role is refused for that
 * and not counted. It runs before every pipe and the handler: a request it refuses is never
 * validated, opens no transaction, and changes nothing; one it lets through has counted, whatever
 * its outcome. Takes no `PrismaService`: a refusal touches no stored data (FR-015).
 */
@Injectable()
export class AttemptLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: AttemptLimitsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const kind = this.reflector.get<RateLimitedAction | undefined>(
      ATTEMPT_LIMIT_KEY,
      context.getHandler(),
    );
    if (!kind) return true;

    const http = context.switchToHttp();
    const principal = http.getRequest<AuthenticatedRequest>().principal;
    // AuthGuard has refused every request without one; a marked route is never public.
    if (!principal) throw new Error('AttemptLimit used on a route without a signed-in caller.');

    const result = this.limits.tryAttempt(principal.sub, kind);
    if (result.ok) return true;

    const n = result.retryAfterSeconds;
    http.getResponse<Response>().setHeader('Retry-After', String(n));
    throw new HttpException(
      {
        error: {
          code: 'RATE_LIMITED',
          message: rateLimitMessage(n),
          details: { action: kind, retryAfterSeconds: n },
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
