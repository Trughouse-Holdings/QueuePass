import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createFakeKeycloak, emptyState, type FakeKeycloak } from './fake-keycloak';

/**
 * Spec 001 FR-004 to FR-007 through spec 010 research R4: `seed()` waits for Keycloak, signs in,
 * then provisions; run as a script, a failure prints "[seed] FAILED:" and exits 1. Spec 028
 * (tasks T015, T021): it renames the old realm when due, then for each app realm provisions the
 * realm, its client and its users, then disables the old copies in the customer realm. Needs no Keycloak: the client module is mocked to
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

/** The realm a call is for, or `-` for the calls that name none (`realms.find`). */
const realmOf = (args: unknown[]): string =>
  (args[0] as { realm?: string } | undefined)?.realm ?? '-';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('KEYCLOAK_URL', undefined);
  client.fake = createFakeKeycloak(emptyState());
  client.waitForKeycloak.mockClear();
  client.createKeycloakClient.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('seed()', () => {
  it('waits, signs in, renames when due, then provisions each app realm in turn', async () => {
    const fake = client.fake!;
    const { seed } = await import('../src/index');

    await seed();

    expect(client.waitForKeycloak).toHaveBeenCalledTimes(1);
    expect(client.createKeycloakClient).toHaveBeenCalledTimes(1);
    expect(client.waitForKeycloak.mock.invocationCallOrder[0]).toBeLessThan(
      client.createKeycloakClient.mock.invocationCallOrder[0],
    );

    // The realm each stretch of calls is for, in order: the rename check (no realm named), each
    // app realm (its realm, client and users), then the customer realm again for the old copies.
    const realms = fake.calls.map((c) => realmOf(c.args));
    const stretches = realms.filter((r, i) => r !== realms[i - 1]);
    expect(stretches).toEqual([
      '-',
      'queuepass-admin-app',
      '-',
      'queuepass-customer-app',
      '-',
      'queuepass-booth-app',
      'queuepass-customer-app',
    ]);
    // Within each app realm: the realm, then its client, then its users.
    const admin = fake.calls.filter((c) => realmOf(c.args) === 'queuepass-admin-app');
    const firstOf = (method: string) => admin.findIndex((c) => c.method === method);
    expect(firstOf('roles.find')).toBeLessThan(firstOf('clients.find'));
    expect(firstOf('clients.find')).toBeLessThan(firstOf('users.find'));
    expect(fake.state.realms.flatMap((r) => r.users)).toHaveLength(235);
    expect(fake.state.realms.flatMap((r) => r.clients)).toHaveLength(3);

    expect(console.log).toHaveBeenCalledWith(
      "[seed] target http://localhost:8080, realms 'queuepass-admin-app', " +
        "'queuepass-customer-app', 'queuepass-booth-app'",
    );
    expect(console.log).toHaveBeenLastCalledWith(
      '[seed] done — queuepass-admin-app: 5 admin, queuepass-customer-app: 200 customer, ' +
        'queuepass-booth-app: 30 agent (235 principals, 3 clients)',
    );
  });

  it('stops at the first failure, provisioning nothing after it', async () => {
    const fake = client.fake!;
    fake.stopAfter('realms.create');
    const { seed } = await import('../src/index');

    await expect(seed()).rejects.toThrow('fake Keycloak: stopped after realms.create (test)');
    expect(fake.state.realms.map((r) => r.rep.realm)).toEqual(['queuepass-admin-app']);
    expect(fake.state.realms[0]!.roles.map((r) => r.name)).toEqual([
      'default-roles-queuepass-admin-app',
    ]);
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
    await import('../src/index');

    await vi.waitFor(() =>
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\[seed\] done — queuepass-admin-app: 5 admin, /),
      ),
    );
    expect(exit).not.toHaveBeenCalled();
  });
});
