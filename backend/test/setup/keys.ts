import { APP_REALMS } from '@queuepass/shared';
import { exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';

/**
 * RS256 key pairs for signing test tokens (research R11). Spec 028 (research R10): one trusted
 * pair per app realm, as each Keycloak realm has its own signing keys; the test app trusts each
 * only for its own realm. `rogue` is deliberately unpublished, for the unknown-key case.
 *
 * Generated once per Jest worker and cached, so every suite in a worker shares them.
 */
export interface TestKey {
  kid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
}

export interface TestKeys {
  /** Realm name → that realm's trusted key pair. */
  realms: Record<string, TestKey>;
  rogue: TestKey;
}

let cached: Promise<TestKeys> | undefined;

async function makeKey(kid: string): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey, publicJwk };
}

export function testKeys(): Promise<TestKeys> {
  cached ??= (async () => {
    const realms: Record<string, TestKey> = {};
    for (const { realm } of APP_REALMS) realms[realm] = await makeKey(`${realm}-key`);
    return { realms, rogue: await makeKey('rogue-key') };
  })();
  return cached;
}
