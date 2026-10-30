import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPECTED_COUNTS, USER_GROUPS, provisionUsers } from '../src/provision-users';
import { createFakeKeycloak, provisionedRealmState } from './fake-keycloak';

/**
 * Spec 001 FR-003 to FR-006 through spec 010 research R4: every test account is created once,
 * enabled, with its group's role and a non-temporary password; a second run creates nothing.
 * Needs no Keycloak (a recording fake).
 */
describe('provisionUsers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('KEYCLOAK_REALM', undefined);
    vi.stubEnv('SEED_USER_PASSWORD', undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('creates all 235 accounts, each once, with its group role', async () => {
    const state = provisionedRealmState();
    const fake = createFakeKeycloak(state);

    await provisionUsers(fake.kc);

    expect(state.users).toHaveLength(EXPECTED_COUNTS.total);
    for (const group of USER_GROUPS) {
      const members = state.users.filter((u) =>
        new RegExp(`^${group.prefix}\\d+$`).test(u.username!),
      );
      expect(members, group.key).toHaveLength(group.count);
      expect(new Set(members.map((u) => u.username)).size).toBe(group.count);
      for (const u of members) expect(u.realmRoles, u.username).toEqual([group.role]);
      expect(console.log).toHaveBeenCalledWith(
        `[seed] ${group.prefix}: ${group.count} created, 0 already present ` +
          `(expected total ${group.count})`,
      );
    }
    expect(state.users.map((u) => u.username)).toContain('customer200');
    expect(state.users.map((u) => u.username)).not.toContain('customer201');
  });

  it('creates each account enabled, verified, with a non-temporary password', async () => {
    const fake = createFakeKeycloak(provisionedRealmState());

    await provisionUsers(fake.kc);

    const [first] = fake.callsTo('users.create')[0];
    expect(first).toEqual({
      realm: 'queuepass',
      username: 'admin1',
      enabled: true,
      emailVerified: true,
      email: 'admin1@queuepass.local',
      firstName: 'admin',
      lastName: '1',
      credentials: [{ type: 'password', value: 'test123', temporary: false }],
    });
    expect(fake.callsTo('users.find')[0]).toEqual([
      { realm: 'queuepass', username: 'admin1', exact: true },
    ]);
  });

  it('maps the role by id and name', async () => {
    const state = provisionedRealmState();
    const fake = createFakeKeycloak(state);
    const admin = state.roles.find((r) => r.name === 'queuepass-admin')!;

    await provisionUsers(fake.kc);

    const [mapping] = fake.callsTo('users.addRealmRoleMappings')[0] as [
      { realm: string; id: string; roles: unknown[] },
    ];
    expect(mapping.realm).toBe('queuepass');
    expect(mapping.id).toBe(state.users[0].id);
    expect(mapping.roles).toEqual([{ id: admin.id, name: 'queuepass-admin' }]);
  });

  it('a second run creates nothing', async () => {
    const state = provisionedRealmState();
    await provisionUsers(createFakeKeycloak(state).kc);
    const fake = createFakeKeycloak(state);

    await provisionUsers(fake.kc);

    expect(fake.callsTo('users.create')).toEqual([]);
    expect(fake.callsTo('users.addRealmRoleMappings')).toEqual([]);
    expect(state.users).toHaveLength(EXPECTED_COUNTS.total);
    expect(console.log).toHaveBeenCalledWith(
      '[seed] customer: 0 created, 200 already present (expected total 200)',
    );
  });

  it('leaves an account that is already present as it is, roles included', async () => {
    const state = provisionedRealmState();
    state.users.push({ id: 'u-old', username: 'agent7', realmRoles: [] });
    const fake = createFakeKeycloak(state);

    await provisionUsers(fake.kc);

    // The seed checks presence by username only: it neither recreates nor re-roles the account.
    expect(state.users.filter((u) => u.username === 'agent7')).toEqual([
      { id: 'u-old', username: 'agent7', realmRoles: [] },
    ]);
    expect(fake.callsTo('users.create')).toHaveLength(EXPECTED_COUNTS.total - 1);
    expect(console.log).toHaveBeenCalledWith(
      '[seed] agent: 29 created, 1 already present (expected total 30)',
    );
  });

  it('matches usernames exactly: agent1 present does not hide agent10', async () => {
    const state = provisionedRealmState();
    state.users.push({ id: 'u-1', username: 'agent1', realmRoles: ['gate-agent'] });
    const fake = createFakeKeycloak(state);

    await provisionUsers(fake.kc);

    expect(state.users.filter((u) => u.username === 'agent10')).toHaveLength(1);
  });

  it('fails with the seed message, creating no one, when a role is missing', async () => {
    const state = provisionedRealmState();
    state.roles = state.roles.filter((r) => r.name !== 'queuepass-admin');
    const fake = createFakeKeycloak(state);

    await expect(provisionUsers(fake.kc)).rejects.toThrow(
      "Role 'queuepass-admin' missing — provisionRealm must run first.",
    );
    expect(fake.callsTo('users.create')).toEqual([]);
  });

  it('fails at the group whose role is missing, after the groups before it', async () => {
    const state = provisionedRealmState();
    state.roles = state.roles.filter((r) => r.name !== 'customer');
    const fake = createFakeKeycloak(state);

    await expect(provisionUsers(fake.kc)).rejects.toThrow("Role 'customer' missing");
    expect(state.users).toHaveLength(EXPECTED_COUNTS.admin + EXPECTED_COUNTS.agent);
  });

  it('treats a role without an id as missing', async () => {
    const state = provisionedRealmState();
    state.roles = state.roles.map((r) => (r.name === 'gate-agent' ? { name: r.name } : r));
    const fake = createFakeKeycloak(state);

    await expect(provisionUsers(fake.kc)).rejects.toThrow("Role 'gate-agent' missing");
  });

  it('uses SEED_USER_PASSWORD and KEYCLOAK_REALM', async () => {
    vi.stubEnv('SEED_USER_PASSWORD', 'other-pass');
    vi.stubEnv('KEYCLOAK_REALM', 'other');
    const fake = createFakeKeycloak(provisionedRealmState('other'));

    await provisionUsers(fake.kc);

    const [first] = fake.callsTo('users.create')[0] as [{ realm: string; credentials: unknown }];
    expect(first.realm).toBe('other');
    expect(first.credentials).toEqual([
      { type: 'password', value: 'other-pass', temporary: false },
    ]);
    expect(fake.callsTo('roles.findOneByName')[0]).toEqual([
      { realm: 'other', name: 'queuepass-admin' },
    ]);
  });
});
