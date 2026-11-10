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
 * something new fails with a message naming what to add here.
 *
 * Spec 028 (research R5, R6, R10; tasks T011): several realms, as Keycloak holds them.
 * - A call names its realm; a realm that does not exist fails, as Keycloak's 404 does.
 * - `realms.create` makes the realm as Keycloak does: its built-in `roles` client scope and its
 *   `default-roles-<realm>` composite role.
 * - `realms.update` with a new `realm` RENAMES it, keeping every user, client, role and scope; the
 *   default-roles composite keeps its old name (Keycloak does not rename it).
 * - User ids are unique across ALL realms, as Keycloak makes them: a create with an id that exists
 *   in any realm fails with 409; any other id sent on create is ignored (a new one is given).
 * - Users and clients can be read and updated (`enabled` included).
 * - Nothing is ever deleted (FR-007): a realm, client or user delete fails the test.
 */

export interface FakeUser extends UserRepresentation {
  /** Realm roles mapped to the user by `users.addRealmRoleMappings`. */
  realmRoles: string[];
}

export interface FakeClientScope extends ClientScopeRepresentation {
  protocolMappers: ProtocolMapperRepresentation[];
}

/** One realm's state. `rep.realm` is its name. */
export interface FakeRealm {
  rep: RealmRepresentation;
  roles: RoleRepresentation[];
  users: FakeUser[];
  clients: ClientRepresentation[];
  clientScopes: FakeClientScope[];
  /** Client internal id → the ids of its default client scopes. */
  defaultScopes: Record<string, string[]>;
}

export interface FakeState {
  realms: FakeRealm[];
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
  /** The realm named `name`; fails when there is none. */
  realm(name: string): FakeRealm;
  /**
   * Makes every call after the first call to `method` fail, as a seed run stopped at that point
   * (T014 (b)); the call to `method` itself goes through.
   */
  stopAfter(method: string): void;
}

type Args = { realm?: string; id?: string };

let nextId = 0;
const newId = (kind: string): string => `${kind}-${++nextId}`;
const copy = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

/** A 409 as the admin client raises it. */
class Conflict extends Error {
  readonly response = { status: 409 };
}

export function emptyState(): FakeState {
  return { realms: [] };
}

/** A realm as Keycloak creates it: the built-in `roles` scope and the default-roles composite. */
export function newRealm(rep: RealmRepresentation): FakeRealm {
  return {
    rep,
    roles: [{ id: newId('role'), name: `default-roles-${rep.realm}`, composite: true }],
    users: [],
    clients: [],
    clientScopes: [
      { id: newId('scope'), name: 'roles', protocol: 'openid-connect', protocolMappers: [] },
    ],
    defaultScopes: {},
  };
}

/** A state holding one fresh realm, with `roles` created in it (as `provisionRealm` leaves it). */
export function provisionedRealmState(realm: string, roles: readonly string[] = []): FakeState {
  const r = newRealm({ realm });
  for (const name of roles) r.roles.push({ id: newId('role'), name });
  return { realms: [r] };
}

/** A user as a test puts one in a realm, with its id and its realm roles. */
export function fakeUser(id: string, username: string, realmRoles: string[]): FakeUser {
  return { id, username, enabled: true, realmRoles };
}

/** Pages a list as Keycloak's admin API does: `first` from 0, `max` 100 unless given. */
const page = <T>(list: T[], { first, max }: { first?: number; max?: number }): T[] =>
  list.slice(first ?? 0, (first ?? 0) + (max ?? 100));

export function createFakeKeycloak(initial: FakeState = emptyState()): FakeKeycloak {
  const state = initial;
  const calls: FakeCall[] = [];
  let stopAt: string | undefined;
  let stopped = false;

  const realm = (name: string | undefined): FakeRealm => {
    const found = state.realms.find((r) => r.rep.realm === name);
    if (!found) throw new Error(`fake Keycloak: no realm '${name}'`);
    return found;
  };
  const allUserIds = (): Set<string> =>
    new Set(state.realms.flatMap((r) => r.users.map((u) => u.id as string)));

  const scope = (r: FakeRealm, id: string | undefined): FakeClientScope => {
    const found = r.clientScopes.find((s) => s.id === id);
    if (!found) throw new Error(`fake Keycloak: no client scope with id '${id}'`);
    return found;
  };
  const user = (r: FakeRealm, id: string | undefined): FakeUser => {
    const found = r.users.find((u) => u.id === id);
    if (!found) throw new Error(`fake Keycloak: no user with id '${id}'`);
    return found;
  };
  const neverDelete = (what: string) => () => {
    throw new Error(`fake Keycloak: ${what} deleted, and nothing is ever deleted (FR-007)`);
  };

  const groups: Record<string, Record<string, (...args: never[]) => unknown>> = {
    realms: {
      find: () => state.realms.map((r) => r.rep),
      // Keycloak answers 404 for an absent realm; the admin client turns that into undefined.
      findOne: ({ realm: name }: { realm: string }) =>
        state.realms.find((r) => r.rep.realm === name)?.rep,
      create: (rep: RealmRepresentation) => {
        if (state.realms.some((r) => r.rep.realm === rep.realm)) {
          throw new Conflict(`fake Keycloak: realm '${rep.realm}' already exists`);
        }
        state.realms.push(newRealm(rep));
        return { realmName: rep.realm };
      },
      // A partial update, as Keycloak's PUT /admin/realms/{realm}: only the fields sent change.
      // A new `realm` renames it, keeping everything in it (research R5).
      update: ({ realm: name }: { realm: string }, rep: RealmRepresentation) => {
        const found = realm(name);
        if (rep.realm !== undefined && rep.realm !== name) {
          if (state.realms.some((r) => r.rep.realm === rep.realm)) {
            throw new Conflict(`fake Keycloak: realm '${rep.realm}' already exists`);
          }
        }
        Object.assign(found.rep, rep);
      },
      del: neverDelete('a realm'),
    },
    roles: {
      find: ({ realm: name }: Args) => realm(name).roles,
      create: ({ realm: name, ...rep }: RoleRepresentation & Args) => {
        realm(name).roles.push({ id: newId('role'), ...rep });
        return { roleName: rep.name };
      },
      findOneByName: ({ realm: name, name: role }: Args & { name: string }) =>
        realm(name).roles.find((r) => r.name === role),
      findUsersWithRole: ({
        realm: name,
        name: role,
        first,
        max,
      }: Args & { name: string; first?: number; max?: number }) =>
        page(
          realm(name).users.filter((u) => u.realmRoles.includes(role)),
          { first, max },
        ),
    },
    users: {
      find: ({
        realm: name,
        username,
        exact,
        first,
        max,
      }: Args & { username?: string; exact?: boolean; first?: number; max?: number }) =>
        page(
          realm(name).users.filter((u) =>
            exact ? u.username === username : (u.username ?? '').includes(username ?? ''),
          ),
          { first, max },
        ),
      findOne: ({ realm: name, id }: Args) => realm(name).users.find((u) => u.id === id),
      create: ({ realm: name, id: asked, ...rep }: UserRepresentation & Args) => {
        const r = realm(name);
        // Research R5: user ids are unique across the server.
        if (asked !== undefined && allUserIds().has(asked)) {
          throw new Conflict(`fake Keycloak: a user with id '${asked}' already exists`);
        }
        if (r.users.some((u) => u.username === rep.username)) {
          throw new Conflict(`fake Keycloak: user '${rep.username}' already exists in '${name}'`);
        }
        const id = newId('user');
        r.users.push({ ...rep, id, realmRoles: [] });
        return { id };
      },
      update: ({ realm: name, id }: Args, rep: UserRepresentation) => {
        const u = user(realm(name), id);
        Object.assign(u, rep, { id: u.id, realmRoles: u.realmRoles });
      },
      addRealmRoleMappings: ({
        realm: name,
        id,
        roles,
      }: Args & { roles: RoleRepresentation[] }) => {
        user(realm(name), id).realmRoles.push(...roles.map((r) => r.name as string));
      },
      del: neverDelete('a user'),
    },
    clients: {
      find: ({ realm: name, clientId }: Args & { clientId?: string }) =>
        realm(name).clients.filter((c) => clientId === undefined || c.clientId === clientId),
      create: ({ realm: name, ...rep }: ClientRepresentation & Args) => {
        const r = realm(name);
        const id = newId('client');
        r.clients.push({ ...rep, id });
        r.defaultScopes[id] = [];
        return { id };
      },
      update: ({ realm: name, id }: Args, rep: ClientRepresentation) => {
        const r = realm(name);
        const index = r.clients.findIndex((c) => c.id === id);
        if (index < 0) throw new Error(`fake Keycloak: no client with id '${id}'`);
        r.clients[index] = { ...rep, id };
      },
      listDefaultClientScopes: ({ realm: name, id }: Args) => {
        const r = realm(name);
        return (r.defaultScopes[id as string] ?? []).map((scopeId) => ({
          id: scopeId,
          name: scope(r, scopeId).name,
        }));
      },
      addDefaultClientScope: ({
        realm: name,
        id,
        clientScopeId,
      }: Args & { clientScopeId: string }) => {
        (realm(name).defaultScopes[id as string] ??= []).push(clientScopeId);
      },
      del: neverDelete('a client'),
    },
    clientScopes: {
      find: ({ realm: name }: Args) => realm(name).clientScopes,
      create: ({ realm: name, ...rep }: ClientScopeRepresentation & Args) => {
        const id = newId('scope');
        realm(name).clientScopes.push({ ...rep, id, protocolMappers: [] });
        return { id };
      },
      listProtocolMappers: ({ realm: name, id }: Args) => scope(realm(name), id).protocolMappers,
      addProtocolMapper: ({ realm: name, id }: Args, mapper: ProtocolMapperRepresentation) => {
        scope(realm(name), id).protocolMappers.push({ ...mapper, id: newId('mapper') });
      },
      delProtocolMapper: ({ realm: name, id, mapperId }: Args & { mapperId: string }) => {
        const s = scope(realm(name), id);
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
            const name = `${group}.${method}`;
            calls.push({ method: name, args: copy(args) });
            if (stopped) throw new Error(`fake Keycloak: stopped after ${stopAt} (test)`);
            if (!impl) throw new Error(`fake Keycloak: ${name} is not implemented`);
            if (name === stopAt) stopped = true;
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

  // Research R5: a state the test sets up holds each user id once across the server.
  const ids = state.realms.flatMap((r) => r.users.map((u) => u.id));
  if (new Set(ids).size !== ids.length) {
    throw new Error('fake Keycloak: a user id appears twice across realms');
  }

  return {
    kc,
    state,
    calls,
    methods: () => calls.map((c) => c.method),
    callsTo: (method) => calls.filter((c) => c.method === method).map((c) => c.args),
    realm: (name) => realm(name),
    stopAfter: (method) => {
      stopAt = method;
    },
  };
}
