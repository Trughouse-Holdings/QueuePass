import type { Provider } from '@nestjs/common';
import { APP_REALMS } from '@queuepass/shared';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

/**
 * Injection token for the key sets used to verify access tokens (spec 001 research R3): one per
 * app realm, by realm name (spec 028 research R8).
 */
export const JWKS = Symbol('JWKS');

/** Realm name → that realm's published signing keys. */
export type RealmKeySets = Readonly<Record<string, JWTVerifyGetKey>>;

export interface OidcConfig {
  /** The browser-facing base of every realm's issuer: `${issuerBase}/${realm}`. */
  issuerBase: string;
  /** Where the Backend fetches keys: `${jwksBase}/${realm}/protocol/openid-connect/certs`. */
  jwksBase: string;
  audience: string;
}

/**
 * Read at startup. The Backend refuses to start without all three (spec 001 FR-019; spec 028
 * research R8). Trailing slashes on the bases are dropped.
 */
export function oidcConfig(): OidcConfig {
  const issuerBase = process.env.OIDC_ISSUER_BASE;
  const jwksBase = process.env.OIDC_JWKS_BASE;
  const audience = process.env.OIDC_AUDIENCE;
  const missing = Object.entries({
    OIDC_ISSUER_BASE: issuerBase,
    OIDC_JWKS_BASE: jwksBase,
    OIDC_AUDIENCE: audience,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Token validation is not configured: set ${missing.join(', ')}.`);
  }
  const trim = (base: string): string => base.replace(/\/+$/, '');
  return { issuerBase: trim(issuerBase!), jwksBase: trim(jwksBase!), audience: audience! };
}

/**
 * Each app realm's published signing keys, fetched over the Compose network and cached, one key
 * set per realm in `APP_REALMS`. An unknown `kid` triggers one refetch (at most every 30 s), which
 * covers key rotation and a Keycloak restart without restarting the Backend. A key set is fetched
 * only when a token of its realm first arrives.
 */
export const jwksProvider: Provider = {
  provide: JWKS,
  useFactory: (): RealmKeySets => {
    const { jwksBase } = oidcConfig();
    return Object.fromEntries(
      APP_REALMS.map(({ realm }) => [
        realm,
        createRemoteJWKSet(new URL(`${jwksBase}/${realm}/protocol/openid-connect/certs`), {
          cooldownDuration: 30_000,
          timeoutDuration: 5_000,
        }),
      ]),
    );
  },
};
