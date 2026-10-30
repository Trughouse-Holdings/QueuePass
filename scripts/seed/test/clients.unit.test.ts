import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIENCE_SCOPE,
  FRONTEND_CLIENTS,
  desiredClient,
  provisionClients,
} from '../src/provision-clients';
import type ClientRepresentation from '@keycloak/keycloak-admin-client/lib/defs/clientRepresentation';
import { createFakeKeycloak, provisionedRealmState, type FakeState } from './fake-keycloak';

/**
 * Spec 001 FR-005 to FR-007 and research R5/R6 through spec 010 research R4: the audience scope
 * and the three front-end clients are created when absent and converged when drifted, each with
 * the audience and roles scopes as defaults. Needs no Keycloak (a recording fake).
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
 * service-account grant, and exact redirect URIs, post-logout URIs, and web origins.
 */
const PORTS = { 'admin-app': 5173, 'customer-app': 5174, 'booth-app': 5175 } as const;

function expectConstitutionalClient(c: ClientRepresentation): void {
  const port = PORTS[c.clientId as keyof typeof PORTS];
  expect(port, `unexpected client ${c.clientId}`).toBeDefined();
  const origin = `http://localhost:${port}`;
  expect(c, c.clientId).toMatchObject({
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

const audienceScope = (state: FakeState) =>
  state.clientScopes.find((s) => s.name === AUDIENCE_SCOPE);
const scopeId = (state: FakeState, name: string) =>
  state.clientScopes.find((s) => s.name === name)!.id!;
const client = (state: FakeState, clientId: string) =>
  state.clients.find((c) => c.clientId === clientId)!;

/** A realm the seed has already converged once. */
async function converged(): Promise<FakeState> {
  const state = provisionedRealmState();
  await provisionClients(createFakeKeycloak(state).kc);
  return state;
}

describe('provisionClients', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('KEYCLOAK_REALM', undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('creates the audience scope once, with its one mapper', async () => {
    const state = provisionedRealmState();
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    expect(fake.callsTo('clientScopes.create')).toEqual([
      [
        {
          realm: 'queuepass',
          name: AUDIENCE_SCOPE,
          protocol: 'openid-connect',
          description: 'Adds the QueuePass API audience to front-end access tokens.',
          attributes: { 'include.in.token.scope': 'false', 'display.on.consent.screen': 'false' },
        },
      ],
    ]);
    expect(fake.callsTo('clientScopes.addProtocolMapper')).toEqual([
      [{ realm: 'queuepass', id: scopeId(state, AUDIENCE_SCOPE) }, AUDIENCE_MAPPER],
    ]);
    expect(state.clientScopes.filter((s) => s.name === AUDIENCE_SCOPE)).toHaveLength(1);
    expect(audienceScope(state)!.protocolMappers).toHaveLength(1);
  });

  it('creates each absent client with exactly its desired settings', async () => {
    const state = provisionedRealmState();
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    expect(fake.callsTo('clients.create')).toEqual(
      FRONTEND_CLIENTS.map((c) => [{ realm: 'queuepass', ...desiredClient(c) }]),
    );
    expect(fake.callsTo('clients.update')).toEqual([]);
    const created = fake.callsTo('clients.create').map(([rep]) => rep as ClientRepresentation);
    expect(created.map((c) => c.clientId)).toEqual(['admin-app', 'customer-app', 'booth-app']);
    for (const c of created) expectConstitutionalClient(c);
    for (const c of FRONTEND_CLIENTS) {
      expect(console.log).toHaveBeenCalledWith(`[seed] created client '${c.clientId}'`);
    }
  });

  it('adds the audience and roles scopes as defaults of every client', async () => {
    const state = provisionedRealmState();
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    const audience = scopeId(state, AUDIENCE_SCOPE);
    const roles = scopeId(state, 'roles');
    for (const c of FRONTEND_CLIENTS) {
      expect(state.defaultScopes[client(state, c.clientId).id!], c.clientId).toEqual([
        audience,
        roles,
      ]);
    }
    expect(fake.callsTo('clients.addDefaultClientScope')).toHaveLength(6);
  });

  it('a second run creates and adds nothing, and keeps every client id', async () => {
    const state = await converged();
    const ids = state.clients.map((c) => c.id);
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    for (const method of [
      'clients.create',
      'clients.addDefaultClientScope',
      'clientScopes.create',
      'clientScopes.addProtocolMapper',
      'clientScopes.delProtocolMapper',
    ]) {
      expect(fake.callsTo(method), method).toEqual([]);
    }
    expect(state.clients.map((c) => c.id)).toEqual(ids);
    expect(fake.callsTo('clients.update')).toHaveLength(FRONTEND_CLIENTS.length);
    for (const [, rep] of fake.callsTo('clients.update')) {
      expectConstitutionalClient(rep as ClientRepresentation);
    }
    expect(console.log).toHaveBeenCalledWith(
      "[seed] client 'admin-app' already present — converged to desired settings",
    );
  });

  it('converges a drifted client to its desired settings, in place', async () => {
    const state = await converged();
    const admin = client(state, 'admin-app');
    const id = admin.id;
    Object.assign(admin, {
      redirectUris: ['http://localhost:5173/*'],
      webOrigins: ['*'],
      directAccessGrantsEnabled: true,
      implicitFlowEnabled: true,
      standardFlowEnabled: false,
      publicClient: false,
      description: 'kept: not a seed setting',
      attributes: {
        ...admin.attributes,
        'pkce.code.challenge.method': 'plain',
        'post.logout.redirect.uris': 'http://localhost:5173/*',
        'kept.attribute': 'yes',
      },
    });
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    const desired = desiredClient(FRONTEND_CLIENTS[0]);
    const after = client(state, 'admin-app');
    expect(after).toEqual({
      ...desired,
      id,
      description: 'kept: not a seed setting',
      attributes: { ...desired.attributes, 'kept.attribute': 'yes' },
    });
    const [target] = fake.callsTo('clients.update')[0];
    expect(target).toEqual({ realm: 'queuepass', id });
    expectConstitutionalClient(after);
  });

  it('adds only the default scope a client is missing', async () => {
    const state = await converged();
    const booth = client(state, 'booth-app').id!;
    const roles = scopeId(state, 'roles');
    state.defaultScopes[booth] = [roles];
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    expect(fake.callsTo('clients.addDefaultClientScope')).toEqual([
      [{ realm: 'queuepass', id: booth, clientScopeId: scopeId(state, AUDIENCE_SCOPE) }],
    ]);
    expect(console.log).toHaveBeenCalledWith(
      `[seed] added default scope '${AUDIENCE_SCOPE}' to 'booth-app'`,
    );
  });

  it('fails with the seed message when the built-in roles scope is missing', async () => {
    const state = provisionedRealmState();
    state.clientScopes = state.clientScopes.filter((s) => s.name !== 'roles');
    const fake = createFakeKeycloak(state);

    await expect(provisionClients(fake.kc)).rejects.toThrow(
      "Built-in client scope 'roles' missing from realm 'queuepass'.",
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
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    expect(fake.callsTo('clientScopes.delProtocolMapper')).toEqual([
      [{ realm: 'queuepass', id: scope.id, mapperId: 'stray' }],
    ]);
    expect(fake.callsTo('clientScopes.addProtocolMapper')).toEqual([]);
    expect(audienceScope(state)!.protocolMappers).toEqual([correct]);
    expect(console.log).toHaveBeenCalledWith(
      `[seed] removed stray mapper 'stray' from '${AUDIENCE_SCOPE}'`,
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
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    expect(fake.callsTo('clientScopes.delProtocolMapper')).toEqual([
      [{ realm: 'queuepass', id: scope.id, mapperId: 'drifted' }],
    ]);
    expect(fake.callsTo('clientScopes.addProtocolMapper')).toEqual([
      [{ realm: 'queuepass', id: scope.id }, AUDIENCE_MAPPER],
    ]);
    const mappers = audienceScope(state)!.protocolMappers;
    expect(mappers).toHaveLength(1);
    expect(mappers[0]).toMatchObject(AUDIENCE_MAPPER);
  });

  it('removes a mapper whose config has no entries', async () => {
    const state = await converged();
    const scope = audienceScope(state)!;
    scope.protocolMappers = [{ ...AUDIENCE_MAPPER, id: 'bare', config: undefined }];
    const fake = createFakeKeycloak(state);

    await provisionClients(fake.kc);

    expect(fake.callsTo('clientScopes.delProtocolMapper')).toHaveLength(1);
    expect(audienceScope(state)!.protocolMappers).toHaveLength(1);
  });

  it('works in the realm KEYCLOAK_REALM names', async () => {
    vi.stubEnv('KEYCLOAK_REALM', 'other');
    const fake = createFakeKeycloak(provisionedRealmState('other'), { realm: 'other' });

    await provisionClients(fake.kc);

    for (const call of fake.calls) {
      expect(call.args[0], call.method).toMatchObject({ realm: 'other' });
    }
  });
});
