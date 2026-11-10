import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_REALMS } from '../src/app-realms';
import { LOGIN_THEME, provisionRealm } from '../src/provision-realm';
import { createFakeKeycloak, emptyState, newRealm } from './fake-keycloak';

/**
 * Spec 001 FR-005 and FR-006 through spec 010 research R4: a realm and its role are created only
 * when absent; spec 021 research R7 (FR-009, FR-010): the realm's login theme is set on create and
 * converged on every run, and nothing else on a present realm changes. Spec 028 (FR-005, FR-008;
 * tasks T015): the same for each app realm, each with its one role. Needs no Keycloak (a
 * recording fake).
 */
describe.each(APP_REALMS.map((r) => [r.realm, r] as const))('provisionRealm: %s', (realm, app) => {
  const { role } = app;
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the absent realm with its settings and login theme, then its one role', async () => {
    const fake = createFakeKeycloak();

    await provisionRealm(fake.kc, realm, role);

    expect(fake.callsTo('realms.create')).toEqual([
      [
        {
          realm,
          enabled: true,
          displayName: 'QueuePass',
          registrationAllowed: false,
          loginWithEmailAllowed: true,
          loginTheme: 'queuepass',
        },
      ],
    ]);
    expect(LOGIN_THEME).toBe('queuepass');
    expect(fake.callsTo('roles.create')).toEqual([[{ realm, name: role }]]);
    expect(fake.methods()).toEqual(['realms.find', 'realms.create', 'roles.find', 'roles.create']);
    expect(console.log).toHaveBeenCalledWith(`[seed] created realm '${realm}'`);
    expect(console.log).toHaveBeenCalledWith(`[seed] ${realm}: set login theme 'queuepass'`);
    expect(console.log).toHaveBeenCalledWith(`[seed] ${realm}: created role '${role}'`);
  });

  it('leaves a present realm already at the login theme, and its role, as they are', async () => {
    const r = newRealm({ realm, displayName: 'Changed by hand', loginTheme: 'queuepass' });
    r.roles.push({ id: 'r1', name: role });
    const fake = createFakeKeycloak({ realms: [r] });

    await provisionRealm(fake.kc, realm, role);

    expect(fake.methods()).toEqual(['realms.find', 'realms.findOne', 'roles.find']);
    expect(fake.callsTo('realms.findOne')).toEqual([[{ realm }]]);
    expect(r.rep).toEqual({ realm, displayName: 'Changed by hand', loginTheme: 'queuepass' });
    expect(console.log).toHaveBeenCalledWith(
      `[seed] realm '${realm}' already present — leaving its other settings as is`,
    );
    expect(console.log).toHaveBeenCalledWith(`[seed] ${realm}: login theme already 'queuepass'`);
    expect(console.log).not.toHaveBeenCalledWith(`[seed] ${realm}: set login theme 'queuepass'`);
    expect(console.log).toHaveBeenCalledWith(`[seed] ${realm}: role '${role}' already present`);
  });

  it.each([
    ['no login theme', undefined],
    ['the stock login theme', 'keycloak'],
  ])('sets the login theme, and only it, on a present realm with %s', async (_, theme) => {
    const r = newRealm({
      realm,
      displayName: 'Changed by hand',
      registrationAllowed: true,
      ...(theme === undefined ? {} : { loginTheme: theme }),
    });
    r.roles.push({ id: 'r1', name: role });
    const fake = createFakeKeycloak({ realms: [r] });

    await provisionRealm(fake.kc, realm, role);

    expect(fake.methods()).toEqual([
      'realms.find',
      'realms.findOne',
      'realms.update',
      'roles.find',
    ]);
    expect(fake.callsTo('realms.update')).toEqual([[{ realm }, { loginTheme: 'queuepass' }]]);
    expect(r.rep).toEqual({
      realm,
      displayName: 'Changed by hand',
      registrationAllowed: true,
      loginTheme: 'queuepass',
    });
    expect(console.log).toHaveBeenCalledWith(`[seed] ${realm}: set login theme 'queuepass'`);
    expect(console.log).not.toHaveBeenCalledWith(
      `[seed] ${realm}: login theme already 'queuepass'`,
    );
  });

  it('a second run after setting the login theme changes nothing', async () => {
    const state = { realms: [newRealm({ realm })] };
    await provisionRealm(createFakeKeycloak(state).kc, realm, role);
    const fake = createFakeKeycloak(state);

    await provisionRealm(fake.kc, realm, role);

    expect(fake.callsTo('realms.update')).toEqual([]);
    expect(fake.callsTo('roles.create')).toEqual([]);
    expect(state.realms[0]!.rep).toEqual({ realm, loginTheme: 'queuepass' });
  });

  it('creates its role when missing, and no other QueuePass role', async () => {
    const r = newRealm({ realm, loginTheme: 'queuepass' });
    r.roles.push({ id: 'r2', name: 'offline_access' });
    const fake = createFakeKeycloak({ realms: [r] });

    await provisionRealm(fake.kc, realm, role);

    expect(fake.callsTo('realms.create')).toEqual([]);
    expect(fake.callsTo('roles.create')).toEqual([[{ realm, name: role }]]);
    expect(r.roles.map((x) => x.name)).toEqual([`default-roles-${realm}`, 'offline_access', role]);
  });

  it('treats other realms as absent, and touches only its own', async () => {
    const state = emptyState();
    state.realms.push(newRealm({ realm: 'master' }), newRealm({ realm: 'queuepass' }));
    const fake = createFakeKeycloak(state);

    await provisionRealm(fake.kc, realm, role);

    expect(fake.callsTo('realms.create')).toHaveLength(1);
    for (const call of fake.calls.slice(1)) {
      expect((call.args[0] as { realm?: string }).realm, call.method).toBe(realm);
    }
    expect(state.realms[0]!.rep).toEqual({ realm: 'master' });
    expect(state.realms[1]!.rep).toEqual({ realm: 'queuepass' });
  });
});
