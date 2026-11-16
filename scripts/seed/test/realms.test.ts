import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_REALMS, LEGACY_REALM, SHARED_REALM_CLIENTS } from '../src/app-realms';
import { desiredClient, FRONTEND_CLIENTS } from '../src/provision-clients';
import { createFakeKeycloak, emptyState, type FakeKeycloak } from './fake-keycloak';

/**
 * Spec 028 FR-005, FR-008, SC-006 (research R4; tasks T012): on a clean system one seed run makes
 * the four app realms, each with the sign-in look, its one role, the audience scope, its one
 * client and exactly its users; no realm `queuepass` is made. Spec 040 (research R3): the Customer
 * realm also holds the Rust Customer app's client, and no extra user. Needs no Keycloak: the client module
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
  it('makes the four app realms and no realm queuepass', async () => {
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

    it('holds the audience scope with its one mapper, and its clients using it', async () => {
      const { seed } = await import('../src/index');
      await seed();

      const r = client.fake!.realm(realm);
      const scope = r.clientScopes.find((s) => s.name === 'queuepass-api');
      expect(scope?.protocolMappers).toEqual([{ ...AUDIENCE_MAPPER, id: expect.any(String) }]);
      // Its own app's client, then (spec 040) each SHARED_REALM_CLIENTS row in this realm.
      const clientIds = [
        app.clientId,
        ...SHARED_REALM_CLIENTS.filter((s) => s.realm === realm).map((s) => s.clientId),
      ];
      const want = clientIds.map((id) => FRONTEND_CLIENTS.find((c) => c.clientId === id)!);
      expect(r.clients).toEqual(want.map((w) => ({ ...desiredClient(w), id: expect.any(String) })));
      const roles = r.clientScopes.find((s) => s.name === 'roles')!;
      for (const c of r.clients) {
        expect(r.defaultScopes[c.id!], c.clientId).toEqual([scope!.id, roles.id]);
      }
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

  it('logs the four realms and their counts last', async () => {
    const { seed } = await import('../src/index');
    await seed();

    expect(console.log).toHaveBeenLastCalledWith(
      '[seed] done — queuepass-admin-app: 5 admin, queuepass-customer-app: 200 customer, ' +
        'queuepass-booth-app: 30 agent, queuepass-admin-rust-app: 5 admin (240 principals, 5 clients)',
    );
  });
});

/** Spec 040 (research R3): the Customer realm holds exactly the two Customer clients. */
describe('the Customer realm (spec 040)', () => {
  it('holds exactly customer-app and customer-rust-app, both enabled', async () => {
    const { seed } = await import('../src/index');
    await seed();

    const clients = client.fake!.realm('queuepass-customer-app').clients;
    expect(clients.map((c) => [c.clientId, c.enabled])).toEqual([
      ['customer-app', true],
      ['customer-rust-app', true],
    ]);
  });

  it('five clients in all, and still 240 principals', async () => {
    const { seed } = await import('../src/index');
    await seed();

    const realms = client.fake!.state.realms;
    expect(realms.flatMap((r) => r.clients)).toHaveLength(5);
    expect(realms.flatMap((r) => r.users)).toHaveLength(240);
  });
});
