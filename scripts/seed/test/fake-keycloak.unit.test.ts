import { describe, expect, it } from 'vitest';
import {
  createFakeKeycloak,
  emptyState,
  fakeUser,
  newRealm,
  provisionedRealmState,
  type FakeState,
} from './fake-keycloak';

/**
 * Spec 010 research R4: the fake names any admin client method it does not implement, so a seed
 * change that calls a new one says what to add. Spec 028 (research R5, R6; tasks T011): it holds
 * several realms, renames a realm keeping what it holds, reads and updates users and clients,
 * makes user ids unique across all realms, and refuses every delete.
 */
describe('the fake Keycloak admin client', () => {
  it('names a method it does not implement, and records the call', async () => {
    const fake = createFakeKeycloak();

    await expect(fake.kc.groups.find()).rejects.toThrow(
      'fake Keycloak: groups.find is not implemented',
    );
    await expect(fake.kc.users.count({ realm: 'x' })).rejects.toThrow(
      'fake Keycloak: users.count is not implemented',
    );
    expect(fake.methods()).toEqual(['groups.find', 'users.count']);
  });

  it('fails a request for a realm that does not exist', async () => {
    const fake = createFakeKeycloak(provisionedRealmState('queuepass-admin-app'));

    await expect(fake.kc.roles.find({ realm: 'master' })).rejects.toThrow(
      "fake Keycloak: no realm 'master'",
    );
    await expect(fake.kc.roles.find({ realm: 'queuepass-admin-app' })).resolves.toEqual([
      expect.objectContaining({ name: 'default-roles-queuepass-admin-app' }),
    ]);
  });

  it('is not a thenable, so it can be returned from an async function', async () => {
    const fake = createFakeKeycloak();

    const resolved = await (async () => fake.kc)();

    expect(resolved).toBe(fake.kc);
  });

  it('creates realms as Keycloak does, each with its own roles scope and default roles', async () => {
    const fake = createFakeKeycloak();
    await fake.kc.realms.create({ realm: 'a', displayName: 'QueuePass' });
    await fake.kc.realms.create({ realm: 'b' });

    expect((await fake.kc.realms.find()).map((r) => r.realm)).toEqual(['a', 'b']);
    for (const name of ['a', 'b']) {
      expect(fake.realm(name).clientScopes.map((s) => s.name)).toEqual(['roles']);
      expect(fake.realm(name).roles.map((r) => r.name)).toEqual([`default-roles-${name}`]);
    }
    await expect(fake.kc.realms.create({ realm: 'a' })).rejects.toThrow(
      "fake Keycloak: realm 'a' already exists",
    );
  });

  it('finds one realm by name, or nothing, and updates only the fields sent', async () => {
    const fake = createFakeKeycloak();
    await fake.kc.realms.create({ realm: 'queuepass', displayName: 'QueuePass' });

    await expect(fake.kc.realms.findOne({ realm: 'queuepass' })).resolves.toEqual({
      realm: 'queuepass',
      displayName: 'QueuePass',
    });
    await fake.kc.realms.update({ realm: 'queuepass' }, { loginTheme: 'queuepass' });

    expect(fake.realm('queuepass').rep).toEqual({
      realm: 'queuepass',
      displayName: 'QueuePass',
      loginTheme: 'queuepass',
    });
    await expect(fake.kc.realms.findOne({ realm: 'other' })).resolves.toBeUndefined();
    await expect(fake.kc.realms.update({ realm: 'other' }, {})).rejects.toThrow(
      "fake Keycloak: no realm 'other'",
    );
  });

  it('renames a realm with the minimal call, keeping its users, clients, roles and scopes (R5)', async () => {
    const state = provisionedRealmState('queuepass', ['customer', 'gate-agent']);
    const old = state.realms[0]!;
    old.rep.displayName = 'QueuePass';
    old.users.push(fakeUser('id-c1', 'customer1', ['customer']));
    old.clients.push({ id: 'cl-1', clientId: 'customer-app' });
    const before = structuredClone(old);
    const fake = createFakeKeycloak(state);

    await fake.kc.realms.update({ realm: 'queuepass' }, { realm: 'queuepass-customer-app' });

    expect(await fake.kc.realms.findOne({ realm: 'queuepass' })).toBeUndefined();
    const renamed = fake.realm('queuepass-customer-app');
    expect(renamed.rep).toEqual({ realm: 'queuepass-customer-app', displayName: 'QueuePass' });
    expect(renamed.users).toEqual(before.users);
    expect(renamed.clients).toEqual(before.clients);
    expect(renamed.clientScopes).toEqual(before.clientScopes);
    // Keycloak does not rename the default-roles composite.
    expect(renamed.roles).toEqual(before.roles);
    expect(renamed.roles.map((r) => r.name)).toContain('default-roles-queuepass');
  });

  it('refuses to rename a realm onto a name in use', async () => {
    const state: FakeState = { realms: [newRealm({ realm: 'a' }), newRealm({ realm: 'b' })] };
    const fake = createFakeKeycloak(state);

    await expect(fake.kc.realms.update({ realm: 'a' }, { realm: 'b' })).rejects.toThrow(
      "fake Keycloak: realm 'b' already exists",
    );
    expect(state.realms.map((r) => r.rep.realm)).toEqual(['a', 'b']);
  });

  it('reads and updates a user, enabled included, keeping its id and roles', async () => {
    const state = provisionedRealmState('r');
    state.realms[0]!.users.push(fakeUser('u-1', 'agent1', ['gate-agent']));
    const fake = createFakeKeycloak(state);

    const user = await fake.kc.users.findOne({ realm: 'r', id: 'u-1' });
    await fake.kc.users.update({ realm: 'r', id: 'u-1' }, { ...user, enabled: false });

    expect(fake.realm('r').users).toEqual([
      { id: 'u-1', username: 'agent1', enabled: false, realmRoles: ['gate-agent'] },
    ]);
    await expect(fake.kc.users.update({ realm: 'r', id: 'nope' }, {})).rejects.toThrow(
      "fake Keycloak: no user with id 'nope'",
    );
  });

  it('reads and updates a client, enabled included', async () => {
    const state = provisionedRealmState('r');
    state.realms[0]!.clients.push({ id: 'c-1', clientId: 'admin-app', enabled: true });
    const fake = createFakeKeycloak(state);

    const [client] = await fake.kc.clients.find({ realm: 'r', clientId: 'admin-app' });
    await fake.kc.clients.update({ realm: 'r', id: 'c-1' }, { ...client, enabled: false });

    expect(fake.realm('r').clients).toEqual([{ id: 'c-1', clientId: 'admin-app', enabled: false }]);
  });

  it('pages users and role members as Keycloak does: 100 unless told', async () => {
    const state = provisionedRealmState('r', ['customer']);
    for (let i = 0; i < 150; i++) {
      state.realms[0]!.users.push(fakeUser(`u-${i}`, `customer${i}`, ['customer']));
    }
    const fake = createFakeKeycloak(state);

    expect(await fake.kc.users.find({ realm: 'r' })).toHaveLength(100);
    expect(await fake.kc.users.find({ realm: 'r', first: 100, max: 100 })).toHaveLength(50);
    expect(await fake.kc.roles.findUsersWithRole({ realm: 'r', name: 'customer' })).toHaveLength(
      100,
    );
    expect(
      await fake.kc.roles.findUsersWithRole({ realm: 'r', name: 'customer', first: 100 }),
    ).toHaveLength(50);
  });

  it('makes user ids unique across all realms (R5)', async () => {
    const state: FakeState = { realms: [newRealm({ realm: 'a' }), newRealm({ realm: 'b' })] };
    state.realms[0]!.users.push(fakeUser('same', 'customer1', ['customer']));
    const fake = createFakeKeycloak(state);

    // A create with an id in use anywhere is a conflict, even in another realm.
    await expect(
      fake.kc.users.create({ realm: 'b', id: 'same', username: 'customer1' }),
    ).rejects.toThrow("fake Keycloak: a user with id 'same' already exists");
    // Any other id sent is ignored, as Keycloak's POST ignores it.
    const { id } = await fake.kc.users.create({ realm: 'b', id: 'mine', username: 'customer1' });
    expect(id).not.toBe('mine');
    const { id: other } = await fake.kc.users.create({ realm: 'a', username: 'admin1' });
    expect(new Set([id, other, 'same']).size).toBe(3);

    const twice: FakeState = { realms: [newRealm({ realm: 'a' }), newRealm({ realm: 'b' })] };
    twice.realms[0]!.users.push(fakeUser('dup', 'x', []));
    twice.realms[1]!.users.push(fakeUser('dup', 'y', []));
    expect(() => createFakeKeycloak(twice)).toThrow(
      'fake Keycloak: a user id appears twice across realms',
    );
  });

  it('refuses a second user of the same name in one realm', async () => {
    const fake = createFakeKeycloak(provisionedRealmState('r'));
    await fake.kc.users.create({ realm: 'r', username: 'admin1' });

    await expect(fake.kc.users.create({ realm: 'r', username: 'admin1' })).rejects.toThrow(
      "fake Keycloak: user 'admin1' already exists in 'r'",
    );
  });

  it.each([
    ['realms.del', 'a realm'],
    ['users.del', 'a user'],
    ['clients.del', 'a client'],
  ])('fails the test on %s: nothing is ever deleted (FR-007)', async (method, what) => {
    const fake = createFakeKeycloak(provisionedRealmState('r'));
    const [group, name] = method.split('.') as [string, string];
    const call = (fake.kc as unknown as Record<string, Record<string, (a: unknown) => unknown>>)[
      group
    ]![name]!;

    await expect(call({ realm: 'r', id: 'x' })).rejects.toThrow(
      `fake Keycloak: ${what} deleted, and nothing is ever deleted (FR-007)`,
    );
  });

  it('stops every call after the one it is told to stop after (a seed run cut short)', async () => {
    const fake = createFakeKeycloak(emptyState());
    fake.stopAfter('realms.create');

    await fake.kc.realms.create({ realm: 'a' });

    await expect(fake.kc.realms.find()).rejects.toThrow(
      'fake Keycloak: stopped after realms.create (test)',
    );
    expect(fake.realm('a').rep.realm).toBe('a');
  });

  it('hands out copies, never its own state', async () => {
    const fake = createFakeKeycloak();
    await fake.kc.realms.create({ realm: 'queuepass' });

    const [realm] = await fake.kc.realms.find();
    realm!.realm = 'changed';

    expect(fake.realm('queuepass').rep).toEqual({ realm: 'queuepass' });
  });
});
