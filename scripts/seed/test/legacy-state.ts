import { desiredClient, FRONTEND_CLIENTS } from '../src/provision-clients';
import { fakeUser, newRealm, type FakeState } from './fake-keycloak';

/**
 * Spec 028 (research R5, R6): a Keycloak as the seed left it before 028: one realm `queuepass`
 * with the three roles, the audience scope, the three clients, and the 235 users, each with a
 * known id (`old-<username>`), its role, enabled.
 */
export function legacyState(): FakeState {
  const realm = newRealm({
    realm: 'queuepass',
    enabled: true,
    displayName: 'QueuePass',
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    loginTheme: 'queuepass',
  });
  for (const name of ['queuepass-admin', 'gate-agent', 'customer']) {
    realm.roles.push({ id: `role-${name}`, name });
  }
  realm.clientScopes.push({
    id: 'scope-api',
    name: 'queuepass-api',
    protocol: 'openid-connect',
    protocolMappers: [
      {
        id: 'mapper-api',
        name: 'queuepass-api-audience',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-audience-mapper',
        config: {
          'included.custom.audience': 'queuepass-api',
          'access.token.claim': 'true',
          'id.token.claim': 'false',
          'introspection.token.claim': 'true',
        },
      },
    ],
  });
  const rolesScope = realm.clientScopes.find((s) => s.name === 'roles')!.id!;
  for (const c of FRONTEND_CLIENTS) {
    const id = `old-client-${c.clientId}`;
    realm.clients.push({ ...desiredClient(c), id });
    realm.defaultScopes[id] = ['scope-api', rolesScope];
  }
  for (const [prefix, count, role] of [
    ['admin', 5, 'queuepass-admin'],
    ['agent', 30, 'gate-agent'],
    ['customer', 200, 'customer'],
  ] as const) {
    for (let i = 1; i <= count; i++) {
      realm.users.push(fakeUser(`old-${prefix}${i}`, `${prefix}${i}`, [role]));
    }
  }
  return { realms: [realm] };
}
