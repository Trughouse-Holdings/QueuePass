import { SetMetadata } from '@nestjs/common';
import type { Role } from '@queuepass/shared';

export const ROLES_KEY = 'roles';

/**
 * Restricts a handler to callers holding at least one of these realm roles. Must match the
 * operation's `x-required-roles` in contracts/openapi.yaml; a test enforces that.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
