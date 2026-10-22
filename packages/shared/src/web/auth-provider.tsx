import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { isRole, type Role } from '../roles.js';
import { apiBaseUrl as defaultApiBaseUrl, createApiClient, type ApiClient } from './api-client.js';

/**
 * Sign-in for every QueuePass front end (spec 001 US2; research R1, R2).
 *
 * - OIDC Authorization Code flow with PKCE, on Keycloak's own login page. No password ever
 *   reaches this code (FR-010).
 * - Tokens are held IN MEMORY ONLY (Constitution V, FR-011). A reload therefore bounces
 *   through Keycloak, which returns immediately while its SSO session is alive.
 * - Only the one-time PKCE state crosses the redirect in sessionStorage; oidc-client-ts
 *   deletes it as soon as the code is exchanged. It is not a token.
 */

/** The subset of UserManager this provider uses, so tests can substitute a fake. */
export interface UserManagerLike {
  getUser(): Promise<User | null>;
  signinRedirect(args?: { state?: unknown }): Promise<void>;
  signinRedirectCallback(): Promise<User>;
  removeUser(): Promise<void>;
  signoutRedirect(args?: {
    id_token_hint?: string;
    post_logout_redirect_uri?: string;
  }): Promise<void>;
  events: {
    addUserLoaded(cb: (user: User) => void): void;
    removeUserLoaded(cb: (user: User) => void): void;
    addAccessTokenExpired(cb: () => void): void;
    removeAccessTokenExpired(cb: () => void): void;
    addSilentRenewError(cb: (err: Error) => void): void;
    removeSilentRenewError(cb: (err: Error) => void): void;
  };
}

export function createUserManager(authority: string, clientId: string): UserManager {
  const origin = window.location.origin;
  return new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${origin}/`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: 'code',
    scope: 'openid profile',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

export interface Auth {
  status: AuthStatus;
  user: User | null;
  username: string | undefined;
  roles: Role[];
  accessToken(): string | undefined;
  /** Sends the browser to Keycloak's login page. */
  signIn(): Promise<void>;
  /** Clears the in-memory user, then ends the Keycloak session (research R2). */
  logout(): Promise<void>;
  /** A typed client for the Backend API that sends this user's token. */
  api: ApiClient;
}

const AuthContext = createContext<Auth | null>(null);

/** Reads the access token's claims without verifying them. The Backend verifies. */
function claimsOf(user: User | null): { username?: string; roles: Role[] } {
  const payload = user?.access_token.split('.')[1];
  if (!payload) return { roles: [] };
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      preferred_username?: string;
      realm_access?: { roles?: unknown[] };
    };
    return {
      username: json.preferred_username ?? (user?.profile.preferred_username as string | undefined),
      roles: (json.realm_access?.roles ?? []).filter(isRole),
    };
  } catch {
    return { roles: [] };
  }
}

const hereAsReturnTo = (): string => `${window.location.pathname}${window.location.search}`;

export interface AuthProviderProps {
  authority?: string;
  clientId?: string;
  /** Substitute for tests. Built from `authority` and `clientId` when omitted. */
  userManager?: UserManagerLike;
  apiBaseUrl?: string;
  /**
   * Spec 015 FR-008 (research R8): runs at logout while the token is still in memory, before the
   * user is cleared. Waited for at most 2 seconds; logout goes on even if it fails or times out.
   */
  beforeLogout?: (api: ApiClient) => Promise<void>;
  children: ReactNode;
}

/** Spec 015 research R8: how long logout waits for `beforeLogout` before going on anyway. */
const BEFORE_LOGOUT_MS = 2_000;

export function AuthProvider({
  authority,
  clientId,
  userManager,
  apiBaseUrl,
  beforeLogout,
  children,
}: AuthProviderProps) {
  const um = useMemo<UserManagerLike>(() => {
    if (userManager) return userManager;
    if (!authority || !clientId) throw new Error('AuthProvider needs authority and clientId.');
    return createUserManager(authority, clientId);
  }, [userManager, authority, clientId]);

  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const userRef = useRef<User | null>(null);
  const loggingOut = useRef(false);

  const apply = useCallback((u: User | null) => {
    userRef.current = u;
    setUser(u);
    setStatus(u ? 'signed-in' : 'signed-out');
  }, []);

  const signIn = useCallback(async () => {
    if (loggingOut.current) return;
    await um.signinRedirect({ state: { returnTo: hereAsReturnTo() } });
  }, [um]);

  // Initial check: finish a redirect back from Keycloak, or use the in-memory user, or go sign in.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.has('code') && params.has('state')) {
        try {
          const u = await um.signinRedirectCallback();
          const returnTo = (u.state as { returnTo?: string } | undefined)?.returnTo ?? '/';
          window.history.replaceState(null, '', returnTo.startsWith('/') ? returnTo : '/');
          if (!cancelled) apply(u);
          return;
        } catch {
          // A stale or replayed code: drop it and start a fresh sign-in.
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      const existing = await um.getUser();
      if (cancelled) return;
      if (existing && !existing.expired) apply(existing);
      else await signIn();
    })();
    return () => {
      cancelled = true;
    };
  }, [um, apply, signIn]);

  // Token lifecycle (FR-013): pick up silent renewals; sign in again when renewal is impossible.
  useEffect(() => {
    const onLoaded = (u: User) => apply(u);
    const onLost = () => {
      void (async () => {
        await um.removeUser();
        apply(null);
        await signIn();
      })();
    };
    um.events.addUserLoaded(onLoaded);
    um.events.addAccessTokenExpired(onLost);
    um.events.addSilentRenewError(onLost);
    return () => {
      um.events.removeUserLoaded(onLoaded);
      um.events.removeAccessTokenExpired(onLost);
      um.events.removeSilentRenewError(onLost);
    };
  }, [um, apply, signIn]);

  // A page restored from the back-forward cache keeps its JavaScript state; re-check that a
  // user is still in memory, so the back button after logout shows no signed-in page (SC-007).
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      void (async () => {
        const current = await um.getUser();
        if (!current || current.expired) {
          apply(null);
          loggingOut.current = false;
          await signIn();
        }
      })();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [um, apply, signIn]);

  const accessToken = useCallback(() => userRef.current?.access_token, []);

  const api = useMemo(
    () => createApiClient(apiBaseUrl ?? defaultApiBaseUrl(), accessToken),
    [apiBaseUrl, accessToken],
  );

  const logout = useCallback(async () => {
    const idToken = userRef.current?.id_token;
    loggingOut.current = true;
    // Spec 015 FR-008: while the token is still here; never longer than 2 seconds, never fatal.
    if (beforeLogout) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        beforeLogout(api).catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, BEFORE_LOGOUT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    // Order matters (research R2): memory first, so any cached snapshot is signed out.
    await um.removeUser();
    apply(null);
    await um.signoutRedirect({
      id_token_hint: idToken,
      post_logout_redirect_uri: `${window.location.origin}/`,
    });
  }, [um, apply, api, beforeLogout]);

  const value = useMemo<Auth>(() => {
    const { username, roles } = claimsOf(user);
    return { status, user, username, roles, accessToken, signIn, logout, api };
  }, [status, user, accessToken, signIn, logout, api]);

  return (
    <AuthContext.Provider value={value}>
      {status === 'signed-in' ? children : <SigningIn />}
    </AuthContext.Provider>
  );
}

function SigningIn() {
  return <p>Signing in…</p>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>.');
  return auth;
}
