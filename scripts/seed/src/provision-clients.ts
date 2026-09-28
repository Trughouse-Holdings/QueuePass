import type KcAdminClient from '@keycloak/keycloak-admin-client';
import type ClientRepresentation from '@keycloak/keycloak-admin-client/lib/defs/clientRepresentation';
import type ProtocolMapperRepresentation from '@keycloak/keycloak-admin-client/lib/defs/protocolMapperRepresentation';
import { loadConfig } from './keycloak-client';

/** One public OIDC client per front end (spec 001 FR-005, research R6). */
export const FRONTEND_CLIENTS = [
  { clientId: 'admin-app', name: 'QueuePass Admin', port: 5173 },
  { clientId: 'customer-app', name: 'QueuePass', port: 5174 },
  { clientId: 'booth-app', name: 'QueuePass Ticket Booth', port: 5175 },
] as const;

/** Client scope whose mapper puts `queuepass-api` in every front-end access token (research R5). */
export const AUDIENCE_SCOPE = 'queuepass-api';
const API_AUDIENCE = 'queuepass-api';

const AUDIENCE_MAPPER: ProtocolMapperRepresentation = {
  name: 'queuepass-api-audience',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  config: {
    'included.custom.audience': API_AUDIENCE,
    'access.token.claim': 'true',
    'id.token.claim': 'false',
    'introspection.token.claim': 'true',
  },
};

/**
 * The exact settings every front-end client converges on. Public (no secret), browser
 * Authorization Code flow with PKCE S256 only, and no password grant, so no front end can
 * ever accept a password (FR-010).
 */
function desiredClient(c: (typeof FRONTEND_CLIENTS)[number]): ClientRepresentation {
  const origin = `http://localhost:${c.port}`;
  return {
    clientId: c.clientId,
    name: c.name,
    enabled: true,
    protocol: 'openid-connect',
    publicClient: true,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
    serviceAccountsEnabled: false,
    frontchannelLogout: true,
    rootUrl: origin,
    baseUrl: '/',
    redirectUris: [`${origin}/*`],
    webOrigins: [origin],
    attributes: {
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': `${origin}/*`,
    },
  };
}

/**
 * Converges the audience scope and the three front-end clients (spec 001 FR-005 to FR-007).
 *
 * Check-then-create like the rest of the seed, but an existing client is UPDATED to the
 * desired settings rather than skipped, so hand-made drift is repaired on every run. Clients
 * are found by clientId and never recreated, so their internal ids stay stable.
 */
export async function provisionClients(kc: KcAdminClient): Promise<void> {
  const { realm } = loadConfig();
  const scopeId = await ensureAudienceScope(kc, realm);
  const rolesScope = (await kc.clientScopes.find({ realm })).find((s) => s.name === 'roles');
  if (!rolesScope?.id)
    throw new Error(`Built-in client scope 'roles' missing from realm '${realm}'.`);

  for (const c of FRONTEND_CLIENTS) {
    const desired = desiredClient(c);
    const [existing] = await kc.clients.find({ realm, clientId: c.clientId });

    let id: string;
    if (!existing?.id) {
      ({ id } = await kc.clients.create({ realm, ...desired }));
      console.log(`[seed] created client '${c.clientId}'`);
    } else {
      id = existing.id;
      await kc.clients.update(
        { realm, id },
        { ...existing, ...desired, attributes: { ...existing.attributes, ...desired.attributes } },
      );
      console.log(`[seed] client '${c.clientId}' already present — converged to desired settings`);
    }

    const defaults = await kc.clients.listDefaultClientScopes({ realm, id });
    for (const scope of [
      { id: scopeId, name: AUDIENCE_SCOPE },
      { id: rolesScope.id, name: 'roles' },
    ]) {
      if (defaults.some((d) => d.id === scope.id)) continue;
      await kc.clients.addDefaultClientScope({ realm, id, clientScopeId: scope.id });
      console.log(`[seed] added default scope '${scope.name}' to '${c.clientId}'`);
    }
  }
}

async function ensureAudienceScope(kc: KcAdminClient, realm: string): Promise<string> {
  let scope = (await kc.clientScopes.find({ realm })).find((s) => s.name === AUDIENCE_SCOPE);
  if (!scope?.id) {
    await kc.clientScopes.create({
      realm,
      name: AUDIENCE_SCOPE,
      protocol: 'openid-connect',
      description: 'Adds the QueuePass API audience to front-end access tokens.',
      attributes: { 'include.in.token.scope': 'false', 'display.on.consent.screen': 'false' },
    });
    scope = (await kc.clientScopes.find({ realm })).find((s) => s.name === AUDIENCE_SCOPE);
    console.log(`[seed] created client scope '${AUDIENCE_SCOPE}'`);
  }
  const id = scope!.id!;

  const mappers = await kc.clientScopes.listProtocolMappers({ realm, id });
  for (const m of mappers) {
    const matches =
      m.name === AUDIENCE_MAPPER.name &&
      m.protocolMapper === AUDIENCE_MAPPER.protocolMapper &&
      Object.entries(AUDIENCE_MAPPER.config!).every(([k, v]) => m.config?.[k] === v);
    if (matches) continue;
    // Exactly one correct mapper must remain: remove strays and drifted copies.
    await kc.clientScopes.delProtocolMapper({ realm, id, mapperId: m.id! });
    console.log(`[seed] removed stray mapper '${m.name}' from '${AUDIENCE_SCOPE}'`);
  }
  const remaining = await kc.clientScopes.listProtocolMappers({ realm, id });
  if (remaining.length === 0) {
    await kc.clientScopes.addProtocolMapper({ realm, id }, AUDIENCE_MAPPER);
    console.log(`[seed] added audience mapper to '${AUDIENCE_SCOPE}'`);
  }
  return id;
}
