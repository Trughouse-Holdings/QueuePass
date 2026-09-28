import { exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';

/**
 * RS256 key pairs for signing test tokens (research R11). The test app trusts only
 * `test-key`; `rogue-key` is deliberately unpublished, for the unknown-key case.
 *
 * Generated once per Jest worker and cached, so every suite in a worker shares them.
 */
export interface TestKey {
  kid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
}

let cached: Promise<{ trusted: TestKey; rogue: TestKey }> | undefined;

async function makeKey(kid: string): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey, publicJwk };
}

export function testKeys(): Promise<{ trusted: TestKey; rogue: TestKey }> {
  cached ??= Promise.all([makeKey('test-key'), makeKey('rogue-key')]).then(([trusted, rogue]) => ({
    trusted,
    rogue,
  }));
  return cached;
}
