import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_REALMS } from '../src/app-realms';
import { EXPECTED_COUNTS, provisionUsers } from '../src/provision-users';
import { createFakeKeycloak, fakeUser, provisionedRealmState } from './fake-keycloak';

/**
 * Spec 001 FR-003 to FR-006 through spec 010 research R4: every test account is created once,
 * enabled, with its role and a non-temporary password; a second run creates nothing. Spec 028
 * (FR-005, tasks T015): each app realm holds exactly its own users. Needs no Keycloak (a
 * recording fake).
 */
describe('the seeded accounts', () => {
  it('are 5 admins, 30 gate agents and 200 customers: 235', () => {
    expect(EXPECTED_COUNTS).toEqual({ admin: 5, agent: 30, customer: 200, total: 235 });
  });
});

describe.each(APP_REALMS.map((r) => [r.realm, r] as const))('provisionUsers: %s', (realm, app) => {
  const { prefix, count, role } = app;
  const state = () => provisionedRealmState(realm, [role]);

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('SEED_USER_PASSWORD', undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it(`creates its ${count} accounts, each once, with its role`, async () => {
    const s = state();
    const fake = createFakeKeycloak(s);

    await provisionUsers(fake.kc, app);

    const users = s.realms[0]!.users;
    expect(users.map((u) => u.username)).toEqual(
      Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`),
    );
    for (const u of users) expect(u.realmRoles, u.username).toEqual([role]);
    expect(console.log).toHaveBeenCalledWith(
      `[seed] ${realm}: ${prefix}: ${count} created, 0 already present (expected total ${count})`,
    );
  });

  it('creates each account enabled, verified, with a non-temporary password, in its realm', async () => {
    const fake = createFakeKeycloak(state());

    await provisionUsers(fake.kc, app);

    const [first] = fake.callsTo('users.create')[0]!;
    expect(first).toEqual({
      realm,
      username: `${prefix}1`,
      enabled: true,
      emailVerified: true,
      email: `${prefix}1@queuepass.local`,
      firstName: prefix,
      lastName: '1',
      credentials: [{ type: 'password', value: 'test123', temporary: false }],
    });
    expect(fake.callsTo('users.find')[0]).toEqual([{ realm, username: `${prefix}1`, exact: true }]);
    for (const call of fake.calls) {
      expect((call.args[0] as { realm?: string }).realm, call.method).toBe(realm);
    }
  });

  it('maps the role by id and name', async () => {
    const s = state();
    const fake = createFakeKeycloak(s);
    const mapped = s.realms[0]!.roles.find((r) => r.name === role)!;

    await provisionUsers(fake.kc, app);

    const [mapping] = fake.callsTo('users.addRealmRoleMappings')[0] as [
      { realm: string; id: string; roles: unknown[] },
    ];
    expect(mapping.realm).toBe(realm);
    expect(mapping.id).toBe(s.realms[0]!.users[0]!.id);
    expect(mapping.roles).toEqual([{ id: mapped.id, name: role }]);
  });

  it('a second run creates nothing', async () => {
    const s = state();
    await provisionUsers(createFakeKeycloak(s).kc, app);
    const fake = createFakeKeycloak(s);

    await provisionUsers(fake.kc, app);

    expect(fake.callsTo('users.create')).toEqual([]);
    expect(fake.callsTo('users.addRealmRoleMappings')).toEqual([]);
    expect(s.realms[0]!.users).toHaveLength(count);
    expect(console.log).toHaveBeenCalledWith(
      `[seed] ${realm}: ${prefix}: 0 created, ${count} already present (expected total ${count})`,
    );
  });

  it('leaves an account that is already present as it is, roles included', async () => {
    const s = state();
    s.realms[0]!.users.push({ ...fakeUser('u-old', `${prefix}3`, []), enabled: false });
    const fake = createFakeKeycloak(s);

    await provisionUsers(fake.kc, app);

    // Presence is checked by username only: the account is neither recreated, re-roled nor enabled.
    expect(s.realms[0]!.users.filter((u) => u.username === `${prefix}3`)).toEqual([
      { id: 'u-old', username: `${prefix}3`, enabled: false, realmRoles: [] },
    ]);
    expect(fake.callsTo('users.create')).toHaveLength(count - 1);
    expect(console.log).toHaveBeenCalledWith(
      `[seed] ${realm}: ${prefix}: ${count - 1} created, 1 already present (expected total ${count})`,
    );
    expect(console.log).toHaveBeenCalledWith(
      `[seed] ${realm}: made missing accounts, each with a new id: ${Array.from(
        { length: count },
        (_, i) => `${prefix}${i + 1}`,
      )
        .filter((u) => u !== `${prefix}3`)
        .join(', ')}`,
    );
  });

  it('matches usernames exactly: the first account present does not hide the tenth', async () => {
    const s = state();
    s.realms[0]!.users.push(fakeUser('u-1', `${prefix}1`, [role]));
    const fake = createFakeKeycloak(s);

    await provisionUsers(fake.kc, app);

    expect(s.realms[0]!.users.filter((u) => u.username === `${prefix}10`).length).toBe(
      count >= 10 ? 1 : 0,
    );
    expect(s.realms[0]!.users).toHaveLength(count);
  });

  it('fails with the seed message, creating no one, when its role is missing', async () => {
    const fake = createFakeKeycloak(provisionedRealmState(realm));

    await expect(provisionUsers(fake.kc, app)).rejects.toThrow(
      `Role '${role}' missing from realm '${realm}' — provisionRealm must run first.`,
    );
    expect(fake.callsTo('users.create')).toEqual([]);
  });

  it('treats a role without an id as missing', async () => {
    const s = state();
    s.realms[0]!.roles = s.realms[0]!.roles.map((r) => (r.name === role ? { name: r.name } : r));
    const fake = createFakeKeycloak(s);

    await expect(provisionUsers(fake.kc, app)).rejects.toThrow(`Role '${role}' missing`);
  });

  it('uses SEED_USER_PASSWORD', async () => {
    vi.stubEnv('SEED_USER_PASSWORD', 'other-pass');
    const fake = createFakeKeycloak(state());

    await provisionUsers(fake.kc, app);

    const [first] = fake.callsTo('users.create')[0] as [{ credentials: unknown }];
    expect(first.credentials).toEqual([
      { type: 'password', value: 'other-pass', temporary: false },
    ]);
  });
});
