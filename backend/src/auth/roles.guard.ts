import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@queuepass/shared';
import type { AuthenticatedRequest } from './principal';
import { ROLES_KEY } from './roles.decorator';

/**
 * Spec 001 FR-021: a validly authenticated caller without a required role gets 403, never 401.
 * Runs after AuthGuard, which has already attached the principal.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const roles = context.switchToHttp().getRequest<AuthenticatedRequest>().principal?.roles ?? [];
    if (requiredRoles.some((r) => roles.includes(r))) return true;

    throw new ForbiddenException({
      message: `This action requires the ${requiredRoles.join(' or ')} role.`,
      requiredRoles,
    });
  }
}
