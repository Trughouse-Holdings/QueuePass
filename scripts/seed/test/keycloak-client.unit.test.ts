import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeycloakClient, loadConfig, waitForKeycloak } from '../src/keycloak-client';

/**
 * Spec 001 research R5 and R15 through spec 010 research R4: the seed's configuration, the
 * start-up wait, and the admin sign-in. Needs no Keycloak: `fetch` and the admin client module
 * are stubbed, and the wait's fixed 2-second pause runs on fake timers.
 */
const kcAdmin = vi.hoisted(() => ({
  constructed: [] as unknown[],
  auth: vi.fn(async (_credentials: unknown) => undefined),
}));

vi.mock('@keycloak/keycloak-admin-client', () => ({
  default: class {
    auth = kcAdmin.auth;
    constructor(options: unknown) {
      kcAdmin.constructed.push(options);
    }
  },
}));

const ENV = [
  'KEYCLOAK_URL',
  'KEYCLOAK_HEALTH_URL',
  'KEYCLOAK_ADMIN',
  'KEYCLOAK_ADMIN_PASSWORD',
  'KEYCLOAK_REALM',
  'SEED_USER_PASSWORD',
] as const;

beforeEach(() => {
  for (const name of ENV) vi.stubEnv(name, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loadConfig', () => {
  it('defaults to the local stack', () => {
    expect(loadConfig()).toEqual({
      url: 'http://localhost:8080',
      // Keycloak 26 serves health on the management port (research R15).
      healthUrl: 'http://localhost:9000',
      adminUser: 'admin',
      adminPassword: 'admin',
      realm: 'queuepass',
      userPassword: 'test123',
    });
  });

  it('takes every setting from the environment', () => {
    vi.stubEnv('KEYCLOAK_URL', 'http://kc:8080');
    vi.stubEnv('KEYCLOAK_HEALTH_URL', 'http://kc:9000');
    vi.stubEnv('KEYCLOAK_ADMIN', 'root');
    vi.stubEnv('KEYCLOAK_ADMIN_PASSWORD', 'secret');
    vi.stubEnv('KEYCLOAK_REALM', 'other');
    vi.stubEnv('SEED_USER_PASSWORD', 'pw');

    expect(loadConfig()).toEqual({
      url: 'http://kc:8080',
      healthUrl: 'http://kc:9000',
      adminUser: 'root',
      adminPassword: 'secret',
      realm: 'other',
      userPassword: 'pw',
    });
  });
});

describe('waitForKeycloak', () => {
  const response = (status: number) => ({ ok: status >= 200 && status < 300, status });

  it('returns at once when Keycloak is ready', async () => {
    const fetch = vi.fn(async () => response(200));
    vi.stubGlobal('fetch', fetch);

    await waitForKeycloak();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('http://localhost:9000/health/ready');
  });

  it('polls the health URL from the environment', async () => {
    vi.stubEnv('KEYCLOAK_HEALTH_URL', 'http://kc:9000');
    const fetch = vi.fn(async () => response(200));
    vi.stubGlobal('fetch', fetch);

    await waitForKeycloak();

    expect(fetch).toHaveBeenCalledWith('http://kc:9000/health/ready');
  });

  it('retries every 2 seconds through refused connections and not-ready answers', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal('fetch', fetch);

    let done = false;
    const wait = waitForKeycloak().then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await wait;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(done).toBe(true);
  });

  it('times out naming the URL, the timeout, and the last status', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => response(404));
    vi.stubGlobal('fetch', fetch);

    const wait = waitForKeycloak(10_000);
    const failed = expect(wait).rejects.toThrow(
      'Keycloak health at http://localhost:9000/health/ready was not ready within 10000ms ' +
        '(last error: status 404). Confirm KC_HEALTH_ENABLED=true and that the management ' +
        'port (9000) is reachable.',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('times out naming the last connection error, Error or not', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
        .mockRejectedValue('socket hang up'),
    );

    const wait = waitForKeycloak(4_000);
    const failed = expect(wait).rejects.toThrow('(last error: socket hang up)');
    await vi.advanceTimersByTimeAsync(4_000);
    await failed;
  });

  it('defaults to a 3-minute timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    const wait = waitForKeycloak();
    const failed = expect(wait).rejects.toThrow('within 180000ms (last error: down)');
    await vi.advanceTimersByTimeAsync(180_000);
    await failed;
  });
});

describe('createKeycloakClient', () => {
  beforeEach(() => {
    kcAdmin.constructed.length = 0;
    kcAdmin.auth.mockClear();
  });

  it('signs in to the master realm as the configured admin with admin-cli', async () => {
    const client = await createKeycloakClient();

    expect(kcAdmin.constructed).toEqual([
      { baseUrl: 'http://localhost:8080', realmName: 'master' },
    ]);
    expect(kcAdmin.auth).toHaveBeenCalledWith({
      username: 'admin',
      password: 'admin',
      grantType: 'password',
      clientId: 'admin-cli',
    });
    expect(client.auth).toBe(kcAdmin.auth);
  });

  it('uses the URL and admin credentials from the environment', async () => {
    vi.stubEnv('KEYCLOAK_URL', 'http://kc:8080');
    vi.stubEnv('KEYCLOAK_ADMIN', 'root');
    vi.stubEnv('KEYCLOAK_ADMIN_PASSWORD', 'secret');

    await createKeycloakClient();

    expect(kcAdmin.constructed).toEqual([{ baseUrl: 'http://kc:8080', realmName: 'master' }]);
    expect(kcAdmin.auth).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'root', password: 'secret' }),
    );
  });

  it('passes a failed sign-in on', async () => {
    kcAdmin.auth.mockRejectedValueOnce(new Error('401 Unauthorized'));

    await expect(createKeycloakClient()).rejects.toThrow('401 Unauthorized');
  });
});
