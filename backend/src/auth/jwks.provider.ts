import type { Provider } from '@nestjs/common';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

/** Injection token for the key set used to verify access tokens (research R3). */
export const JWKS = Symbol('JWKS');

export interface OidcConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

/** Read at startup. The Backend refuses to start without all three (spec 001 FR-019). */
export function oidcConfig(): OidcConfig {
  const issuer = process.env.OIDC_ISSUER;
  const audience = process.env.OIDC_AUDIENCE;
  const jwksUrl = process.env.OIDC_JWKS_URL;
  const missing = Object.entries({
    OIDC_ISSUER: issuer,
    OIDC_AUDIENCE: audience,
    OIDC_JWKS_URL: jwksUrl,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Token validation is not configured: set ${missing.join(', ')}.`);
  }
  return { issuer: issuer!, audience: audience!, jwksUrl: jwksUrl! };
}

/**
 * Keycloak's published signing keys, fetched over the Compose network and cached. An unknown
 * `kid` triggers one refetch (at most every 30 s), which covers key rotation and a Keycloak
 * restart without restarting the Backend.
 */
export const jwksProvider: Provider = {
  provide: JWKS,
  useFactory: (): JWTVerifyGetKey =>
    createRemoteJWKSet(new URL(oidcConfig().jwksUrl), {
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    }),
};
