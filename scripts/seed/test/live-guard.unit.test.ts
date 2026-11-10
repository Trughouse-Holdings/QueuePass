import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveSkipReason, RENAME_SKIP_REASON } from './live-guard';

/**
 * Spec 028 research R13 (tasks T015a): the live seed tests skip on a Keycloak that still has realm
 * `queuepass`, so no test run renames a stack's realm, unless QP_SEED_ALLOW_RENAME=1. Needs no
 * Keycloak: `fetch` is stubbed.
 */
const UNREACHABLE = 'Keycloak not reachable';

/** A `fetch` answering health with `health`, and the old realm's page with `legacy`. */
function stubKeycloak(health: number | Error, legacy: number | Error) {
  const fetch = vi.fn(async (url: string) => {
    const answer = url.endsWith('/health/ready') ? health : legacy;
    if (answer instanceof Error) throw answer;
    return { ok: answer >= 200 && answer < 300, status: answer };
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  for (const name of ['KEYCLOAK_URL', 'KEYCLOAK_HEALTH_URL', 'QP_SEED_ALLOW_RENAME']) {
    vi.stubEnv(name, undefined);
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the live seed tests guard', () => {
  it('names the reason and the switch', () => {
    expect(RENAME_SKIP_REASON).toBe(
      'this Keycloak still has the shared realm; set QP_SEED_ALLOW_RENAME=1 to let the tests rename it',
    );
  });

  it('skips as unreachable when no Keycloak answers, asking nothing else', async () => {
    const fetch = stubKeycloak(new Error('ECONNREFUSED'), 404);

    expect(await liveSkipReason(UNREACHABLE)).toBe(UNREACHABLE);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('http://localhost:9000/health/ready');
  });

  it('skips when the Keycloak still has realm queuepass', async () => {
    const fetch = stubKeycloak(200, 200);

    expect(await liveSkipReason(UNREACHABLE)).toBe(RENAME_SKIP_REASON);
    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/realms/queuepass');
  });

  it('runs on a clean Keycloak: no realm queuepass', async () => {
    stubKeycloak(200, 404);

    expect(await liveSkipReason(UNREACHABLE)).toBeUndefined();
  });

  it('runs over realm queuepass when QP_SEED_ALLOW_RENAME=1, without asking for it', async () => {
    vi.stubEnv('QP_SEED_ALLOW_RENAME', '1');
    const fetch = stubKeycloak(200, 200);

    expect(await liveSkipReason(UNREACHABLE)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('takes only "1" as the switch', async () => {
    vi.stubEnv('QP_SEED_ALLOW_RENAME', 'true');
    stubKeycloak(200, 200);

    expect(await liveSkipReason(UNREACHABLE)).toBe(RENAME_SKIP_REASON);
  });

  it('skips when it cannot tell whether realm queuepass exists', async () => {
    stubKeycloak(200, new Error('socket hang up'));

    expect(await liveSkipReason(UNREACHABLE)).toBe(RENAME_SKIP_REASON);
  });

  it('asks the Keycloak the environment names', async () => {
    vi.stubEnv('KEYCLOAK_URL', 'http://kc:8080');
    vi.stubEnv('KEYCLOAK_HEALTH_URL', 'http://kc:9000');
    const fetch = stubKeycloak(200, 404);

    await liveSkipReason(UNREACHABLE);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://kc:9000/health/ready',
      'http://kc:8080/realms/queuepass',
    ]);
  });
});
