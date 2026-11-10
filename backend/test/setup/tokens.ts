import { APP_REALMS, isRole } from '@queuepass/shared';
import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { testKeys } from './keys';

/** Spec 028 (research R8): the base every app realm's issuer is under, as in Compose. */
export const TEST_ISSUER_BASE = 'http://localhost:8080/realms';
export const TEST_AUDIENCE = 'queuepass-api';

/** A realm's issuer, as Keycloak writes it into the realm's tokens. */
export const issuerFor = (realm: string): string => `${TEST_ISSUER_BASE}/${realm}`;

/** Each app's realm, by app, from the realm table. */
export const REALM = Object.fromEntries(APP_REALMS.map((r) => [r.app, r.realm])) as Record<
  (typeof APP_REALMS)[number]['app'],
  string
>;

/**
 * Spec 028 research R10: the realm a token comes from when a test does not say: the realm of its
 * first QueuePass role, or the Customer app's realm when it has none.
 */
export function realmFor(roles: readonly string[]): string {
  const role = roles.find(isRole);
  return APP_REALMS.find((r) => r.role === role)?.realm ?? REALM.customer;
}

export interface TokenOptions {
  username: string;
  roles: string[];
  sub?: string;
  /** The realm whose key signs the token, and whose issuer it carries unless `iss` is given. */
  realm?: string;
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

/**
 * Signs a token the way Keycloak would for a front-end client (research R11): with the key of its
 * realm (spec 028), by default the realm of its first QueuePass role.
 */
export async function tokenFor(opts: TokenOptions): Promise<string> {
  const keys = await testKeys();
  const realm = opts.realm ?? realmFor(opts.roles);
  const key = opts.rogue ? keys.rogue : keys.realms[realm];
  if (!key) throw new Error(`No test key for realm '${realm}'.`);
  const now = Math.floor(Date.now() / 1000);

  const claims: Record<string, unknown> = { preferred_username: opts.username };
  if (!opts.noRealmAccess) claims.realm_access = { roles: opts.roles };

  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .setSubject(opts.sub ?? subFor(opts.username))
    .setIssuer(opts.iss ?? issuerFor(realm))
    .setAudience(opts.aud ?? TEST_AUDIENCE)
    .setIssuedAt(now - 60);
  if (!opts.noExp) jwt.setExpirationTime(now + (opts.expiresIn ?? 300));
  return jwt.sign(key.privateKey);
}

export const ADMIN: TokenOptions = { username: 'admin1', roles: ['queuepass-admin'] };
export const CUSTOMER: TokenOptions = { username: 'customer1', roles: ['customer'] };
export const AGENT: TokenOptions = { username: 'agent1', roles: ['gate-agent'] };
