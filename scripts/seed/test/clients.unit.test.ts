import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_REALMS } from '../src/app-realms';
import {
  AUDIENCE_SCOPE,
  FRONTEND_CLIENTS,
  desiredClient,
  provisionClient,
} from '../src/provision-clients';
import type ClientRepresentation from '@keycloak/keycloak-admin-client/lib/defs/clientRepresentation';
import {
  createFakeKeycloak,
  provisionedRealmState,
  type FakeRealm,
  type FakeState,
} from './fake-keycloak';

/**
 * Spec 001 FR-005 to FR-007 and research R5/R6 through spec 010 research R4: the audience scope
 * and the three front-end clients are created when absent and converged when drifted, each with
 * the audience and roles scopes as defaults. Spec 028 (FR-005, tasks T015): in each app realm,
 * the audience scope and that app's one client. Needs no Keycloak (a recording fake).
 */
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

/**
 * The constitution's OIDC clients rule, pinned to fixed values rather than to `desiredClient`
 * (review round 1): public, Authorization Code with PKCE S256 only, no password, implicit, or
 * service-account grant, and exact redirect URIs, post-logout URIs, and web origins. The names
 * are the ones each sign-in screen shows, "Sign in to {name}" (spec 021 FR-002).
 */
const PORTS = { 'admin-app': 5173, 'customer-app': 5174, 'booth-app': 5175 } as const;
const NAMES = {
  'admin-app': 'QueuePass Admin',
  'customer-app': 'QueuePass Tickets',
  'booth-app': 'QueuePass Ticket Booth',
} as const;

function expectConstitutionalClient(c: ClientRepresentation): void {
  const port = PORTS[c.clientId as keyof typeof PORTS];
  expect(port, `unexpected client ${c.clientId}`).toBeDefined();
  const origin = `http://localhost:${port}`;
  expect(c, c.clientId).toMatchObject({
    name: NAMES[c.clientId as keyof typeof NAMES],
    protocol: 'openid-connect',
    enabled: true,
    publicClient: true,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: [`${origin}/`],
    webOrigins: [origin],
  });
  expect(c.secret, c.clientId).toBeUndefined();
  expect(c.attributes?.['pkce.code.challenge.method'], c.clientId).toBe('S256');
  expect(c.attributes?.['post.logout.redirect.uris'], c.clientId).toBe(`${origin}/`);
}

const only = (state: FakeState): FakeRealm => state.realms[0]!;
const audienceScope = (state: FakeState) =>
  only(state).clientScopes.find((s) => s.name === AUDIENCE_SCOPE);
const scopeId = (state: FakeState, name: string) =>
  only(state).clientScopes.find((s) => s.name === name)!.id!;
const client = (state: FakeState, clientId: string) =>
  only(state).clients.find((c) => c.clientId === clientId)!;

describe.each(APP_REALMS.map((r) => [r.realm, r.clientId] as const))(
  'provisionClient: %s',
  (realm, clientId) => {
    const c = FRONTEND_CLIENTS.find((f) => f.clientId === clientId)!;
    const fresh = (): FakeState => provisionedRealmState(realm);
    const run = (state: FakeState) => {
      const fake = createFakeKeycloak(state);
      return { fake, done: provisionClient(fake.kc, realm, c) };
    };

    /** A realm the seed has already converged once. */
    async function converged(): Promise<FakeState> {
      const state = fresh();
      await run(state).done;
      return state;
    }

    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates the audience scope once, with its one mapper', async () => {
      const state = fresh();
      const { fake, done } = run(state);
      await done;

      expect(fake.callsTo('clientScopes.create')).toEqual([
        [
          {
            realm,
            name: AUDIENCE_SCOPE,
            protocol: 'openid-connect',
            description: 'Adds the QueuePass API audience to front-end access tokens.',
            attributes: { 'include.in.token.scope': 'false', 'display.on.consent.screen': 'false' },
          },
        ],
      ]);
      expect(fake.callsTo('clientScopes.addProtocolMapper')).toEqual([
        [{ realm, id: scopeId(state, AUDIENCE_SCOPE) }, AUDIENCE_MAPPER],
      ]);
      expect(only(state).clientScopes.filter((s) => s.name === AUDIENCE_SCOPE)).toHaveLength(1);
      expect(audienceScope(state)!.protocolMappers).toHaveLength(1);
    });

    it('creates each absent client with exactly its desired settings', async () => {
      const state = fresh();
      const { fake, done } = run(state);
      await done;

      expect(fake.callsTo('clients.create')).toEqual([[{ realm, ...desiredClient(c) }]]);
      expect(fake.callsTo('clients.update')).toEqual([]);
      const created = fake.callsTo('clients.create').map(([rep]) => rep as ClientRepresentation);
      expect(created.map((x) => x.clientId)).toEqual([clientId]);
      for (const x of created) expectConstitutionalClient(x);
      expect(console.log).toHaveBeenCalledWith(`[seed] ${realm}: created client '${clientId}'`);
    });

    it('adds the audience and roles scopes as defaults of every client', async () => {
      const state = fresh();
      const { fake, done } = run(state);
      await done;

      const audience = scopeId(state, AUDIENCE_SCOPE);
      const roles = scopeId(state, 'roles');
      expect(only(state).defaultScopes[client(state, clientId).id!]).toEqual([audience, roles]);
      expect(fake.callsTo('clients.addDefaultClientScope')).toHaveLength(2);
    });

    it('a second run creates and adds nothing, and keeps every client id', async () => {
      const state = await converged();
      const ids = only(state).clients.map((c) => c.id);
      const { fake, done } = run(state);
      await done;

      for (const method of [
        'clients.create',
        'clients.addDefaultClientScope',
        'clientScopes.create',
        'clientScopes.addProtocolMapper',
        'clientScopes.delProtocolMapper',
      ]) {
        expect(fake.callsTo(method), method).toEqual([]);
      }
      expect(only(state).clients.map((c) => c.id)).toEqual(ids);
      expect(fake.callsTo('clients.update')).toHaveLength(1);
      for (const [, rep] of fake.callsTo('clients.update')) {
        expectConstitutionalClient(rep as ClientRepresentation);
      }
      expect(console.log).toHaveBeenCalledWith(
        `[seed] ${realm}: client '${clientId}' already present — converged to desired settings`,
      );
    });

    it('converges a drifted client to its desired settings, in place', async () => {
      const state = await converged();
      const admin = client(state, clientId);
      const id = admin.id;
      Object.assign(admin, {
        redirectUris: [`http://localhost:${c.port}/*`],
        webOrigins: ['*'],
        directAccessGrantsEnabled: true,
        implicitFlowEnabled: true,
        standardFlowEnabled: false,
        publicClient: false,
        description: 'kept: not a seed setting',
        attributes: {
          ...admin.attributes,
          'pkce.code.challenge.method': 'plain',
          'post.logout.redirect.uris': `http://localhost:${c.port}/*`,
          'kept.attribute': 'yes',
        },
      });
      const { fake, done } = run(state);
      await done;

      const desired = desiredClient(c);
      const after = client(state, clientId);
      expect(after).toEqual({
        ...desired,
        id,
        description: 'kept: not a seed setting',
        attributes: { ...desired.attributes, 'kept.attribute': 'yes' },
      });
      const [target] = fake.callsTo('clients.update')[0];
      expect(target).toEqual({ realm, id });
      expectConstitutionalClient(after);
    });

    // Spec 021 FR-002 and R7: a realm seeded before 021 has the Customer app as "QueuePass"; the
    // next run renames it in place, and a name already right is written unchanged.
    it('renames a client seeded under an older name, in place, and keeps the rest', async () => {
      const state = await converged();
      const customer = client(state, clientId);
      const id = customer.id;
      Object.assign(customer, { name: 'QueuePass', description: 'kept: not a seed setting' });
      const { fake, done } = run(state);
      await done;

      const after = client(state, clientId);
      expect(after).toMatchObject({
        id,
        name: c.name,
        description: 'kept: not a seed setting',
      });
      expectConstitutionalClient(after);
      const renamed = fake
        .callsTo('clients.update')
        .find(([target]) => (target as { id: string }).id === id)!;
      expect(renamed[1]).toMatchObject({ name: c.name });
      expect(fake.callsTo('clients.create')).toEqual([]);
      for (const x of only(state).clients)
        expect(x.name, x.clientId).toBe(NAMES[x.clientId as keyof typeof NAMES]);
    });

    it('adds only the default scope a client is missing', async () => {
      const state = await converged();
      const booth = client(state, clientId).id!;
      const roles = scopeId(state, 'roles');
      only(state).defaultScopes[booth] = [roles];
      const { fake, done } = run(state);
      await done;

      expect(fake.callsTo('clients.addDefaultClientScope')).toEqual([
        [{ realm, id: booth, clientScopeId: scopeId(state, AUDIENCE_SCOPE) }],
      ]);
      expect(console.log).toHaveBeenCalledWith(
        `[seed] ${realm}: added default scope '${AUDIENCE_SCOPE}' to '${clientId}'`,
      );
    });

    it('fails with the seed message when the built-in roles scope is missing', async () => {
      const state = fresh();
      only(state).clientScopes = only(state).clientScopes.filter((s) => s.name !== 'roles');
      const { fake, done } = run(state);

      await expect(done).rejects.toThrow(
        `Built-in client scope 'roles' missing from realm '${realm}'.`,
      );
      expect(fake.callsTo('clients.create')).toEqual([]);
    });

    it('removes a stray mapper and keeps the correct one', async () => {
      const state = await converged();
      const scope = audienceScope(state)!;
      const correct = scope.protocolMappers[0];
      scope.protocolMappers.push({
        id: 'stray',
        name: 'stray',
        protocolMapper: 'oidc-hardcoded-claim-mapper',
      });
      const { fake, done } = run(state);
      await done;

      expect(fake.callsTo('clientScopes.delProtocolMapper')).toEqual([
        [{ realm, id: scope.id, mapperId: 'stray' }],
      ]);
      expect(fake.callsTo('clientScopes.addProtocolMapper')).toEqual([]);
      expect(audienceScope(state)!.protocolMappers).toEqual([correct]);
      expect(console.log).toHaveBeenCalledWith(
        `[seed] ${realm}: removed stray mapper 'stray' from '${AUDIENCE_SCOPE}'`,
      );
    });

    it('replaces a drifted copy of the audience mapper with the right one', async () => {
      const state = await converged();
      const scope = audienceScope(state)!;
      scope.protocolMappers = [
        {
          ...AUDIENCE_MAPPER,
          id: 'drifted',
          config: { ...AUDIENCE_MAPPER.config, 'access.token.claim': 'false' },
        },
      ];
      const { fake, done } = run(state);
      await done;

      expect(fake.callsTo('clientScopes.delProtocolMapper')).toEqual([
        [{ realm, id: scope.id, mapperId: 'drifted' }],
      ]);
      expect(fake.callsTo('clientScopes.addProtocolMapper')).toEqual([
        [{ realm, id: scope.id }, AUDIENCE_MAPPER],
      ]);
      const mappers = audienceScope(state)!.protocolMappers;
      expect(mappers).toHaveLength(1);
      expect(mappers[0]).toMatchObject(AUDIENCE_MAPPER);
    });

    it('removes a mapper whose config has no entries', async () => {
      const state = await converged();
      const scope = audienceScope(state)!;
      scope.protocolMappers = [{ ...AUDIENCE_MAPPER, id: 'bare', config: undefined }];
      const { fake, done } = run(state);
      await done;

      expect(fake.callsTo('clientScopes.delProtocolMapper')).toHaveLength(1);
      expect(audienceScope(state)!.protocolMappers).toHaveLength(1);
    });

    it('works in its own realm only, beside other realms', async () => {
      const state = fresh();
      state.realms.push(...provisionedRealmState('queuepass').realms);
      const { fake, done } = run(state);
      await done;

      for (const call of fake.calls) {
        expect(call.args[0], call.method).toMatchObject({ realm });
      }
      expect(state.realms[1]!.clients).toEqual([]);
    });
  },
);
