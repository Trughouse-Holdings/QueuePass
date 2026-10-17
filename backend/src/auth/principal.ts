import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@queuepass/shared';

/** The caller, as read from a validated access token. Never persisted (data-model §2). */
export interface Principal {
  sub: string;
  username: string;
  roles: Role[];
  /** Spec 015 research R9: the token's `exp`, in seconds; a seat stream ends then. */
  expiresAt: number;
}

export interface AuthenticatedRequest {
  principal?: Principal;
}

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => {
    const principal = ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (!principal)
      throw new Error('CurrentPrincipal used on a route without an authenticated principal.');
    return principal;
  },
);
