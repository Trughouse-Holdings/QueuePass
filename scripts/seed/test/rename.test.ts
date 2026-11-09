import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeKeycloak, type FakeKeycloak } from './fake-keycloak';
import { legacyState } from './legacy-state';

/**
 * Spec 028 FR-006, FR-007, FR-009, SC-004 (research R5, R6; tasks T013): over a Keycloak made
 * before 028, one seed run renames realm `queuepass` to the Customer app's realm, so the 200
 * customers keep their ids; disables (never deletes) the 35 old admin and agent copies and the
 * other two apps' clients there; and makes new admin and agent accounts in their own realms. A
 * second run changes nothing. Needs no Keycloak (a recording fake).
 */
const client = vi.hoisted(() => ({ fake: undefined as FakeKeycloak | undefined }));

vi.mock('../src/keycloak-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/keycloak-client')>()),
  waitForKeycloak: async () => undefined,
  createKeycloakClient: async () => client.fake!.kc,
}));

const CUSTOMER = 'queuepass-customer-app';
const DELETES = ['realms.del', 'users.del', 'clients.del'];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  client.fake = createFakeKeycloak(legacyState());
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function seedOnce(): Promise<FakeKeycloak> {
  const { seed } = await import('../src/index');
  await seed();
  return client.fake!;
}

describe('the seed over a realm queuepass from before 028', () => {
  it('renames it to the customer realm: no realm queuepass is left', async () => {
    const fake = await seedOnce();

    expect(fake.state.realms.map((r) => r.rep.realm).sort()).toEqual([
      'queuepass-admin-app',
      'queuepass-booth-app',
      'queuepass-customer-app',
    ]);
    expect(fake.callsTo('realms.update')[0]).toEqual([
      { realm: 'queuepass' },
      { realm: 'queuepass-customer-app' },
    ]);
  });

  it('keeps the 200 customers in the customer realm with the same ids, enabled', async () => {
    const fake = await seedOnce();

    const customers = fake.realm(CUSTOMER).users.filter((u) => u.realmRoles.includes('customer'));
    expect(customers.map((u) => [u.username, u.id, u.enabled])).toEqual(
      Array.from({ length: 200 }, (_, i) => [`customer${i + 1}`, `old-customer${i + 1}`, true]),
    );
    expect(
      fake.callsTo('users.create').filter(([u]) => (u as { realm: string }).realm === CUSTOMER),
    ).toEqual([]);
  });

  it('disables the 35 old admin and agent copies there, deleting none', async () => {
    const fake = await seedOnce();

    const others = fake.realm(CUSTOMER).users.filter((u) => !u.realmRoles.includes('customer'));
    expect(others.map((u) => u.username)).toEqual([
      ...Array.from({ length: 5 }, (_, i) => `admin${i + 1}`),
      ...Array.from({ length: 30 }, (_, i) => `agent${i + 1}`),
    ]);
    for (const u of others)
      expect(u, u.username).toMatchObject({ enabled: false, id: `old-${u.username}` });
    expect(fake.realm(CUSTOMER).users).toHaveLength(235);
    for (const del of DELETES) expect(fake.callsTo(del), del).toEqual([]);
  });

  it('disables its admin-app and booth-app clients, and converges customer-app', async () => {
    const fake = await seedOnce();

    const clients = fake.realm(CUSTOMER).clients;
    expect(clients.map((c) => [c.clientId, c.id, c.enabled])).toEqual([
      ['admin-app', 'old-client-admin-app', false],
      ['customer-app', 'old-client-customer-app', true],
      ['booth-app', 'old-client-booth-app', false],
    ]);
    expect(clients.find((c) => c.clientId === 'customer-app')).toMatchObject({
      name: 'QueuePass Tickets',
      publicClient: true,
      directAccessGrantsEnabled: false,
    });
  });

  it('keeps the realm settings, the roles, and the audience scope of the old realm', async () => {
    const before = structuredClone(client.fake!.state.realms[0]!);
    const fake = await seedOnce();

    const after = fake.realm(CUSTOMER);
    expect(after.rep).toEqual({ ...before.rep, realm: CUSTOMER });
    expect(after.roles.map((r) => r.name)).toEqual(before.roles.map((r) => r.name));
    expect(after.clientScopes).toEqual(before.clientScopes);
  });

  it.each([
    ['queuepass-admin-app', 'admin', 5, 'queuepass-admin'],
    ['queuepass-booth-app', 'agent', 30, 'gate-agent'],
  ] as const)(
    'gives %s new accounts for its %s users, with new ids',
    async (realm, prefix, count, role) => {
      const fake = await seedOnce();

      const users = fake.realm(realm).users;
      expect(users.map((u) => u.username)).toEqual(
        Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`),
      );
      for (const u of users) {
        expect(u.enabled).toBe(true);
        expect(u.realmRoles).toEqual([role]);
        expect(u.id).not.toBe(`old-${u.username}`);
      }
    },
  );

  it('logs the rename and what it disabled', async () => {
    await seedOnce();

    expect(console.log).toHaveBeenCalledWith(
      "[seed] renamed realm 'queuepass' to 'queuepass-customer-app': its users keep their ids",
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[seed\] queuepass-customer-app: disabled 35 old accounts without the 'customer' role: admin1, /,
      ),
    );
    expect(console.log).toHaveBeenCalledWith(
      "[seed] queuepass-customer-app: disabled client 'admin-app'",
    );
    expect(console.log).toHaveBeenCalledWith(
      "[seed] queuepass-customer-app: disabled client 'booth-app'",
    );
  });

  it('a second run makes no change at all', async () => {
    const first = await seedOnce();
    const after = structuredClone(first.state);
    client.fake = createFakeKeycloak(first.state);

    const second = await seedOnce();

    expect(second.state).toEqual(after);
    for (const write of [
      'realms.create',
      'realms.update',
      'roles.create',
      'users.create',
      'users.update',
      'users.addRealmRoleMappings',
      'clients.create',
      'clientScopes.create',
      'clientScopes.addProtocolMapper',
      'clients.addDefaultClientScope',
      ...DELETES,
    ]) {
      expect(second.callsTo(write), write).toEqual([]);
    }
    expect(console.log).toHaveBeenCalledWith(
      "[seed] queuepass-customer-app: no enabled account without the 'customer' role",
    );
  });
});
