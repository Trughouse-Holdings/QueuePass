import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { testKeys } from './keys';

export const TEST_ISSUER = 'http://localhost:8080/realms/queuepass';
export const TEST_AUDIENCE = 'queuepass-api';

export interface TokenOptions {
  username: string;
  roles: string[];
  sub?: string;
  iss?: string;
  aud?: string | string[];
  /** Seconds from now until `exp`. Negative values make an already-expired token. */
  expiresIn?: number;
  /** Sign with the unpublished rogue key instead of the trusted one. */
  rogue?: boolean;
  /** Omit `realm_access` entirely. */
  noRealmAccess?: boolean;
  /** Omit `exp` entirely. */
  noExp?: boolean;
}

/** A stable subject per username, shaped like a Keycloak user id. */
export function subFor(username: string): string {
  const h = createHash('sha256').update(username).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Signs a token the way Keycloak would for a front-end client (research R11). */
export async function tokenFor(opts: TokenOptions): Promise<string> {
  const { trusted, rogue } = await testKeys();
  const key = opts.rogue ? rogue : trusted;
  const now = Math.floor(Date.now() / 1000);

  const claims: Record<string, unknown> = { preferred_username: opts.username };
  if (!opts.noRealmAccess) claims.realm_access = { roles: opts.roles };

  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .setSubject(opts.sub ?? subFor(opts.username))
    .setIssuer(opts.iss ?? TEST_ISSUER)
    .setAudience(opts.aud ?? TEST_AUDIENCE)
    .setIssuedAt(now - 60);
  if (!opts.noExp) jwt.setExpirationTime(now + (opts.expiresIn ?? 300));
  return jwt.sign(key.privateKey);
}

export const ADMIN: TokenOptions = { username: 'admin1', roles: ['queuepass-admin'] };
export const CUSTOMER: TokenOptions = { username: 'customer1', roles: ['customer'] };
export const AGENT: TokenOptions = { username: 'agent1', roles: ['gate-agent'] };
