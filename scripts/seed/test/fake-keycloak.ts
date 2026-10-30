import type KcAdminClient from '@keycloak/keycloak-admin-client';
import type ClientRepresentation from '@keycloak/keycloak-admin-client/lib/defs/clientRepresentation';
import type ClientScopeRepresentation from '@keycloak/keycloak-admin-client/lib/defs/clientScopeRepresentation';
import type ProtocolMapperRepresentation from '@keycloak/keycloak-admin-client/lib/defs/protocolMapperRepresentation';
import type RealmRepresentation from '@keycloak/keycloak-admin-client/lib/defs/realmRepresentation';
import type RoleRepresentation from '@keycloak/keycloak-admin-client/lib/defs/roleRepresentation';
import type UserRepresentation from '@keycloak/keycloak-admin-client/lib/defs/userRepresentation';

/**
 * Spec 010 research R4: a recording fake of the Keycloak admin client, so the seed's tests need
 * no Keycloak. It implements exactly the methods `scripts/seed/src/*.ts` calls, over in-memory
 * state, and records every call. It is a Proxy: calling any other method throws
 * `fake Keycloak: <group>.<method> is not implemented`, so a change to the seed that calls
 * something new (for example spec 021's `realms.findOne` and `realms.update`) fails with a
 * message naming what to add here.
 *
 * One realm's worth of state: the seed only ever works in one realm, and every call's `realm`
 * argument is recorded, so a test can check it.
 */

export interface FakeUser extends UserRepresentation {
  /** Realm roles mapped to the user by `users.addRealmRoleMappings`. */
  realmRoles: string[];
}

export interface FakeClientScope extends ClientScopeRepresentation {
  protocolMappers: ProtocolMapperRepresentation[];
}

export interface FakeState {
  realms: RealmRepresentation[];
  roles: RoleRepresentation[];
  users: FakeUser[];
  clients: ClientRepresentation[];
  clientScopes: FakeClientScope[];
  /** Client internal id → the ids of its default client scopes. */
  defaultScopes: Record<string, string[]>;
}

export interface FakeCall {
  /** `<group>.<method>`, for example `clients.update`. */
  method: string;
  args: unknown[];
}

export interface FakeKeycloak {
  kc: KcAdminClient;
  state: FakeState;
  calls: FakeCall[];
  /** The method names called, in order. */
  methods(): string[];
  /** The arguments of every call to one method, in order. */
  callsTo(method: string): unknown[][];
}

type Args = { realm?: string; id?: string };

let nextId = 0;
const newId = (kind: string): string => `${kind}-${++nextId}`;
const copy = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

export function emptyState(): FakeState {
  return {
    realms: [],
    roles: [],
    users: [],
    clients: [],
    clientScopes: [],
    defaultScopes: {},
  };
}

/** A realm as a fresh Keycloak has it after `provisionRealm`: realm, roles, the built-in `roles` scope. */
export function provisionedRealmState(realm = 'queuepass'): FakeState {
  const state = emptyState();
  state.realms.push({ realm });
  for (const name of ['queuepass-admin', 'gate-agent', 'customer']) {
    state.roles.push({ id: newId('role'), name });
  }
  state.clientScopes.push({
    id: newId('scope'),
    name: 'roles',
    protocol: 'openid-connect',
    protocolMappers: [],
  });
  return state;
}

export function createFakeKeycloak(initial: FakeState = emptyState()): FakeKeycloak {
  const state = initial;
  const calls: FakeCall[] = [];

  const scope = (id: string | undefined): FakeClientScope => {
    const found = state.clientScopes.find((s) => s.id === id);
    if (!found) throw new Error(`fake Keycloak: no client scope with id '${id}'`);
    return found;
  };

  const groups: Record<string, Record<string, (...args: never[]) => unknown>> = {
    realms: {
      find: () => state.realms,
      create: (rep: RealmRepresentation) => {
        state.realms.push(rep);
        return { realmName: rep.realm };
      },
    },
    roles: {
      find: () => state.roles,
      create: ({ realm: _realm, ...rep }: RoleRepresentation & Args) => {
        state.roles.push({ id: newId('role'), ...rep });
        return { roleName: rep.name };
      },
      findOneByName: ({ name }: { name: string }) => state.roles.find((r) => r.name === name),
    },
    users: {
      find: ({ username, exact }: { username?: string; exact?: boolean }) =>
        state.users.filter((u) =>
          exact ? u.username === username : (u.username ?? '').includes(username ?? ''),
        ),
      create: ({ realm: _realm, ...rep }: UserRepresentation & Args) => {
        const id = newId('user');
        state.users.push({ ...rep, id, realmRoles: [] });
        return { id };
      },
      addRealmRoleMappings: ({ id, roles }: { id: string; roles: RoleRepresentation[] }) => {
        const user = state.users.find((u) => u.id === id);
        if (!user) throw new Error(`fake Keycloak: no user with id '${id}'`);
        user.realmRoles.push(...roles.map((r) => r.name as string));
      },
    },
    clients: {
      find: ({ clientId }: { clientId?: string }) =>
        state.clients.filter((c) => clientId === undefined || c.clientId === clientId),
      create: ({ realm: _realm, ...rep }: ClientRepresentation & Args) => {
        const id = newId('client');
        state.clients.push({ ...rep, id });
        state.defaultScopes[id] = [];
        return { id };
      },
      update: ({ id }: Args, rep: ClientRepresentation) => {
        const index = state.clients.findIndex((c) => c.id === id);
        if (index < 0) throw new Error(`fake Keycloak: no client with id '${id}'`);
        state.clients[index] = { ...rep, id };
      },
      listDefaultClientScopes: ({ id }: Args) =>
        (state.defaultScopes[id as string] ?? []).map((scopeId) => ({
          id: scopeId,
          name: scope(scopeId).name,
        })),
      addDefaultClientScope: ({ id, clientScopeId }: Args & { clientScopeId: string }) => {
        (state.defaultScopes[id as string] ??= []).push(clientScopeId);
      },
    },
    clientScopes: {
      find: () => state.clientScopes,
      create: ({ realm: _realm, ...rep }: ClientScopeRepresentation & Args) => {
        const id = newId('scope');
        state.clientScopes.push({ ...rep, id, protocolMappers: [] });
        return { id };
      },
      listProtocolMappers: ({ id }: Args) => scope(id).protocolMappers,
      addProtocolMapper: ({ id }: Args, mapper: ProtocolMapperRepresentation) => {
        scope(id).protocolMappers.push({ ...mapper, id: newId('mapper') });
      },
      delProtocolMapper: ({ id, mapperId }: Args & { mapperId: string }) => {
        const s = scope(id);
        s.protocolMappers = s.protocolMappers.filter((m) => m.id !== mapperId);
      },
    },
  };

  // Not a thenable, and invisible to anything probing symbols: only string keys are groups.
  const isProbe = (prop: string | symbol): prop is symbol | 'then' =>
    typeof prop === 'symbol' || prop === 'then';

  const groupProxy = (group: string): object =>
    new Proxy(
      {},
      {
        get: (_target, method) => {
          if (isProbe(method)) return undefined;
          const impl = groups[group]?.[method];
          return async (...args: unknown[]) => {
            calls.push({ method: `${group}.${method}`, args: copy(args) });
            if (!impl) throw new Error(`fake Keycloak: ${group}.${method} is not implemented`);
            // Copies in and out, as over HTTP: the seed can never alias the fake's state.
            return copy(await (impl as (...a: unknown[]) => unknown)(...copy(args)));
          };
        },
      },
    );

  const kc = new Proxy(
    {},
    {
      get: (_target, group) => (isProbe(group) ? undefined : groupProxy(group)),
    },
  ) as KcAdminClient;

  return {
    kc,
    state,
    calls,
    methods: () => calls.map((c) => c.method),
    callsTo: (method) => calls.filter((c) => c.method === method).map((c) => c.args),
  };
}
