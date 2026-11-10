import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_REALMS, LEGACY_REALM } from '../src/app-realms';
import { desiredClient, FRONTEND_CLIENTS } from '../src/provision-clients';
import { createFakeKeycloak, emptyState, type FakeKeycloak } from './fake-keycloak';

/**
 * Spec 028 FR-005, FR-008, SC-006 (research R4; tasks T012): on a clean system one seed run makes
 * the three app realms, each with the sign-in look, its one role, the audience scope, its one
 * client and exactly its users; no realm `queuepass` is made. Needs no Keycloak: the client module
 * is mocked to hand the seed a recording fake.
 */
const client = vi.hoisted(() => ({ fake: undefined as FakeKeycloak | undefined }));

vi.mock('../src/keycloak-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/keycloak-client')>()),
  waitForKeycloak: async () => undefined,
  createKeycloakClient: async () => client.fake!.kc,
}));

const AUDIENCE_MAPPER = {
  name: 'queuepass-api-audience',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  config: {
    'included.custom.audience': 'queuepass-api',
    'access.token.claim': 'true',
    'id.token.claim': 'false',
    'introspection.token.claim': 'true',
  },
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubEnv('SEED_USER_PASSWORD', undefined);
  client.fake = createFakeKeycloak(emptyState());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the seed on a clean system', () => {
  it('makes the three app realms and no realm queuepass', async () => {
    const { seed } = await import('../src/index');

    await seed();

    const fake = client.fake!;
    expect(fake.state.realms.map((r) => r.rep.realm)).toEqual(APP_REALMS.map((r) => r.realm));
    expect(fake.state.realms.map((r) => r.rep.realm)).not.toContain(LEGACY_REALM);
  });

  describe.each(APP_REALMS.map((r) => [r.realm, r] as const))('%s', (realm, app) => {
    it('is enabled, named QueuePass, with the queuepass login theme (FR-008)', async () => {
      const { seed } = await import('../src/index');
      await seed();

      expect(client.fake!.realm(realm).rep).toEqual({
        realm,
        enabled: true,
        displayName: 'QueuePass',
        registrationAllowed: false,
        loginWithEmailAllowed: true,
        loginTheme: 'queuepass',
      });
    });

    it('holds its one app role, no other QueuePass role', async () => {
      const { seed } = await import('../src/index');
      await seed();

      expect(client.fake!.realm(realm).roles.map((r) => r.name)).toEqual([
        `default-roles-${realm}`,
        app.role,
      ]);
    });

    it('holds the audience scope with its one mapper, and its one client using it', async () => {
      const { seed } = await import('../src/index');
      await seed();

      const r = client.fake!.realm(realm);
      const scope = r.clientScopes.find((s) => s.name === 'queuepass-api');
      expect(scope?.protocolMappers).toEqual([{ ...AUDIENCE_MAPPER, id: expect.any(String) }]);
      const want = FRONTEND_CLIENTS.find((c) => c.clientId === app.clientId)!;
      expect(r.clients).toEqual([{ ...desiredClient(want), id: expect.any(String) }]);
      const roles = r.clientScopes.find((s) => s.name === 'roles')!;
      expect(r.defaultScopes[r.clients[0]!.id!]).toEqual([scope!.id, roles.id]);
    });

    it(`holds exactly its ${app.count} users, enabled, with its role and the seed password`, async () => {
      const { seed } = await import('../src/index');
      await seed();

      const users = client.fake!.realm(realm).users;
      expect(users.map((u) => u.username)).toEqual(
        Array.from({ length: app.count }, (_, i) => `${app.prefix}${i + 1}`),
      );
      for (const u of users) {
        expect(u, u.username).toMatchObject({
          enabled: true,
          emailVerified: true,
          email: `${u.username}@queuepass.local`,
          realmRoles: [app.role],
          credentials: [{ type: 'password', value: 'test123', temporary: false }],
        });
      }
    });
  });

  it('a second run changes nothing', async () => {
    const { seed } = await import('../src/index');
    await seed();
    const after = structuredClone(client.fake!.state);
    client.fake = createFakeKeycloak(client.fake!.state);

    await seed();

    expect(client.fake.state).toEqual(after);
    for (const write of [
      'realms.create',
      'realms.update',
      'roles.create',
      'users.create',
      'users.update',
      'clients.create',
      'clientScopes.create',
      'clientScopes.addProtocolMapper',
      'clients.addDefaultClientScope',
    ]) {
      expect(client.fake.callsTo(write), write).toEqual([]);
    }
  });

  it('logs the three realms and their counts last', async () => {
    const { seed } = await import('../src/index');
    await seed();

    expect(console.log).toHaveBeenLastCalledWith(
      '[seed] done — queuepass-admin-app: 5 admin, queuepass-customer-app: 200 customer, ' +
        'queuepass-booth-app: 30 agent (235 principals, 3 clients)',
    );
  });
});
