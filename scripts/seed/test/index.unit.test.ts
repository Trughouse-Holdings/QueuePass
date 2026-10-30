import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createFakeKeycloak, emptyState, type FakeKeycloak } from './fake-keycloak';

/**
 * Spec 001 FR-004 to FR-007 through spec 010 research R4: `seed()` waits for Keycloak, signs in,
 * then provisions the realm, the users, and the clients, in that order; run as a script, a
 * failure prints "[seed] FAILED:" and exits 1. Needs no Keycloak: the client module is mocked to
 * hand the seed a recording fake. The entry point is tested in process (a child process's
 * coverage is not counted), by importing the module afresh with `process.argv[1]` set.
 */
const client = vi.hoisted(() => ({
  fake: undefined as FakeKeycloak | undefined,
  waitForKeycloak: vi.fn(async () => undefined),
  createKeycloakClient: vi.fn(async (): Promise<unknown> => client.fake!.kc),
}));

vi.mock('../src/keycloak-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/keycloak-client')>()),
  waitForKeycloak: client.waitForKeycloak,
  createKeycloakClient: client.createKeycloakClient,
}));

const groupOf = (method: string) => {
  const group = method.split('.')[0];
  return group === 'clientScopes' ? 'clients' : group;
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const name of ['KEYCLOAK_URL', 'KEYCLOAK_REALM']) vi.stubEnv(name, undefined);
  client.fake = createFakeKeycloak(emptyState());
  client.waitForKeycloak.mockClear();
  client.createKeycloakClient.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('seed()', () => {
  it('waits, signs in, then provisions realm, users, and clients in that order', async () => {
    const fake = client.fake!;
    // Keycloak creates the built-in roles scope with a realm; an empty fake needs it given.
    fake.state.clientScopes.push({ id: 'roles-id', name: 'roles', protocolMappers: [] });
    const { seed } = await import('../src/index');

    await seed();

    expect(client.waitForKeycloak).toHaveBeenCalledTimes(1);
    expect(client.createKeycloakClient).toHaveBeenCalledTimes(1);
    expect(client.waitForKeycloak.mock.invocationCallOrder[0]).toBeLessThan(
      client.createKeycloakClient.mock.invocationCallOrder[0],
    );

    const order = fake.methods().map(groupOf);
    const phases = order.filter((g, i) => g !== order[i - 1]);
    // roles.findOneByName is the users step's first request.
    expect(phases).toEqual([
      'realms',
      'roles',
      'users',
      'roles',
      'users',
      'roles',
      'users',
      'clients',
    ]);
    expect(fake.state.users).toHaveLength(235);
    expect(fake.state.clients).toHaveLength(3);

    expect(console.log).toHaveBeenCalledWith(
      "[seed] target http://localhost:8080, realm 'queuepass'",
    );
    expect(console.log).toHaveBeenLastCalledWith(
      '[seed] done — 235 principals (5 admins, 30 gate agents, 200 customers) and 3 clients',
    );
  });

  it('stops at the first failure, provisioning nothing after it', async () => {
    const fake = client.fake!;
    const { seed } = await import('../src/index');
    // No roles scope: the realm and users are provisioned, then the clients step fails.

    await expect(seed()).rejects.toThrow("Built-in client scope 'roles' missing");
    expect(fake.callsTo('clients.create')).toEqual([]);
  });

  it('provisions nothing when Keycloak never becomes ready', async () => {
    client.waitForKeycloak.mockRejectedValueOnce(new Error('not ready'));
    const { seed } = await import('../src/index');

    await expect(seed()).rejects.toThrow('not ready');
    expect(client.createKeycloakClient).not.toHaveBeenCalled();
    expect(client.fake!.calls).toEqual([]);
  });
});

describe('the entry point', () => {
  let argv1: string | undefined;
  let exit: MockInstance<typeof process.exit>;

  beforeEach(() => {
    argv1 = process.argv[1];
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.resetModules();
  });
  afterEach(() => {
    process.argv[1] = argv1 as string;
    vi.resetModules();
  });

  it('does not run the seed when imported by another script', async () => {
    await import('../src/index');

    expect(client.waitForKeycloak).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('run as scripts/seed/src/index.ts, prints the failure and exits 1', async () => {
    process.argv[1] = '/repo/scripts/seed/src/index.ts';
    client.waitForKeycloak.mockRejectedValueOnce(new Error('Keycloak health was not ready'));

    await import('../src/index');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(console.error).toHaveBeenCalledWith('[seed] FAILED:', 'Keycloak health was not ready');
  });

  it('prints a failure that is not an Error as it is (Windows path)', async () => {
    process.argv[1] = 'C:\\repo\\scripts\\seed\\src\\index.ts';
    client.waitForKeycloak.mockRejectedValueOnce('plain reason');

    await import('../src/index');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(console.error).toHaveBeenCalledWith('[seed] FAILED:', 'plain reason');
  });

  it('run as a script that succeeds, exits normally', async () => {
    process.argv[1] = '/repo/scripts/seed/src/index.ts';
    client.fake!.state.clientScopes.push({ id: 'roles-id', name: 'roles', protocolMappers: [] });

    await import('../src/index');

    await vi.waitFor(() =>
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[seed\] done — 235/)),
    );
    expect(exit).not.toHaveBeenCalled();
  });
});
