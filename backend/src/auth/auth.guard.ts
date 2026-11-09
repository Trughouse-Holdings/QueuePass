import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_REALMS, type Role } from '@queuepass/shared';
import { decodeJwt, errors, jwtVerify } from 'jose';
import { JWKS, oidcConfig, type OidcConfig, type RealmKeySets } from './jwks.provider';
import type { AuthenticatedRequest } from './principal';
import { IS_PUBLIC_KEY } from './public.decorator';

/** Seconds of clock skew tolerated on `exp` (spec 001 edge cases: at most 60). */
const CLOCK_TOLERANCE_S = 30;

/** An app realm a token may come from: its name and the one role it grants (spec 028). */
interface TrustedRealm {
  realm: string;
  role: Role;
}

/**
 * Spec 001 FR-018 to FR-020: every request except @Public() handlers must carry a valid
 * Keycloak access token. There is deliberately no way to switch this off (FR-026).
 *
 * Spec 028 FR-010, FR-011 (research R8): the token's issuer must be exactly one of the three app
 * realms' issuers; it is read unverified only to pick the realm, and the token is then verified
 * with that realm's keys and issuer. Of its realm roles, only that realm's app role counts.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly config: OidcConfig = oidcConfig();
  /** Issuer → its realm, for the three app realms only. */
  private readonly realms: ReadonlyMap<string, TrustedRealm> = new Map(
    APP_REALMS.map(({ realm, role }) => [`${this.config.issuerBase}/${realm}`, { realm, role }]),
  );

  constructor(
    private readonly reflector: Reflector,
    @Inject(JWKS) private readonly jwks: RealmKeySets,
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
      // Unverified, only to choose the realm: any other issuer is refused before a key is fetched.
      const issuer = decodeJwt(token).iss;
      const trusted = typeof issuer === 'string' ? this.realms.get(issuer) : undefined;
      const keys = trusted && this.jwks[trusted.realm];
      if (!issuer || !trusted || !keys) return this.refuse('issuer is not an app realm');

      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: this.config.audience,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_S,
        // Constitution V: a token must expire. Without this, jwtVerify checks `exp` only when the
        // token has one.
        requiredClaims: ['exp'],
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

      // requiredClaims has already refused a token without exp; this narrows the type.
      if (typeof payload.exp !== 'number') return this.refuse('token lacks exp');

      const realmRoles = (payload.realm_access as { roles?: unknown } | undefined)?.roles;
      request.principal = {
        sub: payload.sub,
        username,
        // FR-011: only the realm's own app role; any other role in the token is ignored.
        roles: Array.isArray(realmRoles) && realmRoles.includes(trusted.role) ? [trusted.role] : [],
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
