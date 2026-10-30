import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGIN_THEME, REALM_ROLES, provisionRealm } from '../src/provision-realm';
import { createFakeKeycloak, emptyState } from './fake-keycloak';

/**
 * Spec 001 FR-005 and FR-006 through spec 010 research R4: the realm and its roles are created
 * only when absent; spec 021 research R7 (FR-009, FR-010): the realm's login theme is set on
 * create and converged on every run, and nothing else on a present realm changes. Needs no
 * Keycloak (a recording fake).
 */
describe('provisionRealm', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('KEYCLOAK_REALM', undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('creates an absent realm with its settings and login theme, then the three roles', async () => {
    const fake = createFakeKeycloak();

    await provisionRealm(fake.kc);

    expect(fake.callsTo('realms.create')).toEqual([
      [
        {
          realm: 'queuepass',
          enabled: true,
          displayName: 'QueuePass',
          registrationAllowed: false,
          loginWithEmailAllowed: true,
          loginTheme: 'queuepass',
        },
      ],
    ]);
    expect(LOGIN_THEME).toBe('queuepass');
    expect(fake.callsTo('roles.create')).toEqual(
      REALM_ROLES.map((name) => [{ realm: 'queuepass', name }]),
    );
    expect(fake.methods()).toEqual([
      'realms.find',
      'realms.create',
      'roles.find',
      'roles.create',
      'roles.create',
      'roles.create',
    ]);
    expect(console.log).toHaveBeenCalledWith("[seed] created realm 'queuepass'");
    expect(console.log).toHaveBeenCalledWith("[seed] set login theme 'queuepass'");
  });

  it('leaves a present realm already at the login theme, and its roles, as they are', async () => {
    const state = emptyState();
    state.realms.push({
      realm: 'queuepass',
      displayName: 'Changed by hand',
      loginTheme: 'queuepass',
    });
    state.roles.push(...REALM_ROLES.map((name, i) => ({ id: `r${i}`, name })));
    const fake = createFakeKeycloak(state);

    await provisionRealm(fake.kc);

    expect(fake.methods()).toEqual(['realms.find', 'realms.findOne', 'roles.find']);
    expect(fake.callsTo('realms.findOne')).toEqual([[{ realm: 'queuepass' }]]);
    expect(state.realms).toEqual([
      { realm: 'queuepass', displayName: 'Changed by hand', loginTheme: 'queuepass' },
    ]);
    expect(console.log).toHaveBeenCalledWith(
      "[seed] realm 'queuepass' already present — leaving its other settings as is",
    );
    expect(console.log).toHaveBeenCalledWith("[seed] login theme already 'queuepass'");
    expect(console.log).not.toHaveBeenCalledWith("[seed] set login theme 'queuepass'");
    for (const role of REALM_ROLES) {
      expect(console.log).toHaveBeenCalledWith(`[seed] role '${role}' already present`);
    }
  });

  it.each([
    ['no login theme', undefined],
    ['the stock login theme', 'keycloak'],
  ])('sets the login theme, and only it, on a present realm with %s', async (_, theme) => {
    const state = emptyState();
    state.realms.push({
      realm: 'queuepass',
      displayName: 'Changed by hand',
      registrationAllowed: true,
      ...(theme === undefined ? {} : { loginTheme: theme }),
    });
    state.roles.push(...REALM_ROLES.map((name, i) => ({ id: `r${i}`, name })));
    const fake = createFakeKeycloak(state);

    await provisionRealm(fake.kc);

    expect(fake.methods()).toEqual([
      'realms.find',
      'realms.findOne',
      'realms.update',
      'roles.find',
    ]);
    expect(fake.callsTo('realms.update')).toEqual([
      [{ realm: 'queuepass' }, { loginTheme: 'queuepass' }],
    ]);
    expect(state.realms).toEqual([
      {
        realm: 'queuepass',
        displayName: 'Changed by hand',
        registrationAllowed: true,
        loginTheme: 'queuepass',
      },
    ]);
    expect(console.log).toHaveBeenCalledWith("[seed] set login theme 'queuepass'");
    expect(console.log).not.toHaveBeenCalledWith("[seed] login theme already 'queuepass'");
  });

  it('a second run after setting the login theme changes nothing', async () => {
    const state = emptyState();
    state.realms.push({ realm: 'queuepass' });
    await provisionRealm(createFakeKeycloak(state).kc);
    const fake = createFakeKeycloak(state);

    await provisionRealm(fake.kc);

    expect(fake.callsTo('realms.update')).toEqual([]);
    expect(fake.callsTo('roles.create')).toEqual([]);
    expect(state.realms).toEqual([{ realm: 'queuepass', loginTheme: 'queuepass' }]);
  });

  it('creates only the roles that are missing', async () => {
    const state = emptyState();
    state.realms.push({ realm: 'queuepass' });
    state.roles.push({ id: 'r1', name: 'gate-agent' }, { id: 'r2', name: 'offline_access' });
    const fake = createFakeKeycloak(state);

    await provisionRealm(fake.kc);

    expect(fake.callsTo('realms.create')).toEqual([]);
    expect(fake.callsTo('roles.create')).toEqual([
      [{ realm: 'queuepass', name: 'queuepass-admin' }],
      [{ realm: 'queuepass', name: 'customer' }],
    ]);
    expect(state.roles.map((r) => r.name).sort()).toEqual(
      ['customer', 'gate-agent', 'offline_access', 'queuepass-admin'].sort(),
    );
  });

  it('treats another realm of a different name as absent', async () => {
    const state = emptyState();
    state.realms.push({ realm: 'master' });
    const fake = createFakeKeycloak(state);

    await provisionRealm(fake.kc);

    expect(fake.callsTo('realms.create')).toHaveLength(1);
  });

  it('uses KEYCLOAK_REALM for the realm name and every role request', async () => {
    vi.stubEnv('KEYCLOAK_REALM', 'other');
    const fake = createFakeKeycloak(emptyState(), { realm: 'other' });

    await provisionRealm(fake.kc);

    expect(fake.callsTo('realms.create')[0][0]).toMatchObject({ realm: 'other' });
    expect(fake.callsTo('roles.find')).toEqual([[{ realm: 'other' }]]);
    for (const [args] of fake.callsTo('roles.create')) {
      expect(args).toMatchObject({ realm: 'other' });
    }
  });

  it('converges the login theme of the realm KEYCLOAK_REALM names', async () => {
    vi.stubEnv('KEYCLOAK_REALM', 'other');
    const state = emptyState();
    state.realms.push({ realm: 'other' });
    const fake = createFakeKeycloak(state, { realm: 'other' });

    await provisionRealm(fake.kc);

    expect(fake.callsTo('realms.findOne')).toEqual([[{ realm: 'other' }]]);
    expect(fake.callsTo('realms.update')).toEqual([
      [{ realm: 'other' }, { loginTheme: 'queuepass' }],
    ]);
  });
});
