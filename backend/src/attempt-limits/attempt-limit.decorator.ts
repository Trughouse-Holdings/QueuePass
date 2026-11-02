import { SetMetadata } from '@nestjs/common';
import type { RateLimitedAction } from '@queuepass/shared';

export const ATTEMPT_LIMIT_KEY = 'attemptLimit';

/**
 * Spec 026 FR-001 (research R1): marks a handler whose every request from a signed-in customer is
 * an attempt of this kind, limited by `AttemptLimitGuard`. Must match the operation's
 * `x-attempt-limit` in contracts/openapi.yaml; the route-coverage test enforces that.
 */
export const AttemptLimit = (kind: RateLimitedAction): MethodDecorator =>
  SetMetadata(ATTEMPT_LIMIT_KEY, kind);
