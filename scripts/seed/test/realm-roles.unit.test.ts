import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REALM_ROLES, provisionRealm } from '../src/provision-realm';
import { createFakeKeycloak, emptyState } from './fake-keycloak';

/**
 * Spec 001 FR-005 and FR-006 through spec 010 research R4: the realm and its roles are created
 * only when absent. Needs no Keycloak (a recording fake).
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

  it('creates an absent realm with its settings, then the three roles', async () => {
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
        },
      ],
    ]);
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
  });

  it('leaves a present realm and its roles as they are', async () => {
    const state = emptyState();
    state.realms.push({ realm: 'queuepass', displayName: 'Changed by hand' });
    state.roles.push(...REALM_ROLES.map((name, i) => ({ id: `r${i}`, name })));
    const fake = createFakeKeycloak(state);

    await provisionRealm(fake.kc);

    expect(fake.methods()).toEqual(['realms.find', 'roles.find']);
    expect(state.realms).toEqual([{ realm: 'queuepass', displayName: 'Changed by hand' }]);
    expect(console.log).toHaveBeenCalledWith(
      "[seed] realm 'queuepass' already present — leaving as is",
    );
    for (const role of REALM_ROLES) {
      expect(console.log).toHaveBeenCalledWith(`[seed] role '${role}' already present`);
    }
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
});
