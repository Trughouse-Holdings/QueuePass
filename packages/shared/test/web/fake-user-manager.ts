import { vi } from 'vitest';
import type { User } from 'oidc-client-ts';
import type { UserManagerLike } from '../../src/web/auth-provider';

const b64url = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A User whose access token is an unsigned JWT: the front end decodes it, never verifies it. */
export function makeUser(opts: { username: string; roles: string[]; expiresIn?: number }): User {
  const exp = Math.floor(Date.now() / 1000) + (opts.expiresIn ?? 300);
  const access_token = [
    b64url({ alg: 'RS256', typ: 'JWT' }),
    b64url({ preferred_username: opts.username, realm_access: { roles: opts.roles }, exp }),
    'sig',
  ].join('.');
  return {
    access_token,
    id_token: `id-token-for-${opts.username}`,
    refresh_token: 'refresh',
    token_type: 'Bearer',
    profile: { sub: `sub-${opts.username}`, preferred_username: opts.username },
    expires_at: exp,
    expired: (opts.expiresIn ?? 300) <= 0,
    state: undefined,
  } as unknown as User;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stands in for several listener signatures
type Listener = (...args: any[]) => void;

/** Test double for oidc-client-ts's UserManager. Records call order in `calls`. */
export function fakeUserManager(initial: User | null = null) {
  let user = initial;
  const calls: string[] = [];
  const listeners: Record<string, Listener[]> = {};
  const on = (name: string) => (cb: Listener) => {
    (listeners[name] ??= []).push(cb);
  };
  const off = (name: string) => (cb: Listener) => {
    listeners[name] = (listeners[name] ?? []).filter((l) => l !== cb);
  };

  const um = {
    calls,
    get currentUser() {
      return user;
    },
    getUser: vi.fn(async () => {
      calls.push('getUser');
      return user;
    }),
    signinRedirect: vi.fn(async (_args?: unknown) => {
      calls.push('signinRedirect');
    }),
    signinRedirectCallback: vi.fn(async () => {
      calls.push('signinRedirectCallback');
      user = makeUser({ username: 'callback-user', roles: ['customer'] });
      return user;
    }),
    removeUser: vi.fn(async () => {
      calls.push('removeUser');
      user = null;
    }),
    signoutRedirect: vi.fn(async (_args?: unknown) => {
      calls.push('signoutRedirect');
    }),
    events: {
      addUserLoaded: on('userLoaded'),
      removeUserLoaded: off('userLoaded'),
      addAccessTokenExpired: on('accessTokenExpired'),
      removeAccessTokenExpired: off('accessTokenExpired'),
      addSilentRenewError: on('silentRenewError'),
      removeSilentRenewError: off('silentRenewError'),
    },
    emit(name: 'userLoaded' | 'accessTokenExpired' | 'silentRenewError', arg?: unknown) {
      for (const l of listeners[name] ?? []) l(arg);
    },
  };
  return um satisfies UserManagerLike;
}
