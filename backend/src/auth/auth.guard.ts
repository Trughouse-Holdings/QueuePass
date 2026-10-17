import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isRole } from '@queuepass/shared';
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { JWKS, oidcConfig, type OidcConfig } from './jwks.provider';
import type { AuthenticatedRequest } from './principal';
import { IS_PUBLIC_KEY } from './public.decorator';

/** Seconds of clock skew tolerated on `exp` (spec 001 edge cases: at most 60). */
const CLOCK_TOLERANCE_S = 30;

/**
 * Spec 001 FR-018 to FR-020: every request except @Public() handlers must carry a valid
 * Keycloak access token. There is deliberately no way to switch this off (FR-026).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly config: OidcConfig = oidcConfig();

  constructor(
    private readonly reflector: Reflector,
    @Inject(JWKS) private readonly jwks: JWTVerifyGetKey,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { headers: Record<string, string | undefined> }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return this.refuse('missing bearer token');

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_S,
      });

      const username = payload.preferred_username;
      if (
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        typeof username !== 'string' ||
        !username
      ) {
        return this.refuse('token lacks sub or preferred_username');
      }

      // jwtVerify has already refused a token without a valid exp.
      if (typeof payload.exp !== 'number') return this.refuse('token lacks exp');

      const realmRoles = (payload.realm_access as { roles?: unknown } | undefined)?.roles;
      request.principal = {
        sub: payload.sub,
        username,
        roles: Array.isArray(realmRoles) ? realmRoles.filter(isRole) : [],
        expiresAt: payload.exp,
      };
      return true;
    } catch (err) {
      const reason =
        err instanceof errors.JOSEError ? err.code : err instanceof Error ? err.message : 'unknown';
      return this.refuse(reason);
    }
  }

  private refuse(reason: string): never {
    // Log the reason server-side only; never the token, and never tell the caller which check failed.
    this.logger.warn(`Refused request: ${reason}`);
    throw new UnauthorizedException();
  }
}
