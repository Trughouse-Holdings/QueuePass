import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ErrorResponse, InMemoryWebStorage, User } from 'oidc-client-ts';
import type { ApiClient } from '../../src/web/api-client';
import { AuthProvider, createUserManager, useAuth } from '../../src/web/auth-provider';
import { fakeUserManager, makeUser } from './fake-user-manager';

/** Spec 001 FR-009, FR-011, FR-013, US2-8; research R1, R2. */
function Probe() {
  const auth = useAuth();
  return (
    <p>
      status={auth.status} user={auth.username ?? '-'} roles={auth.roles.join(',')}
    </p>
  );
}

const TOKENISH = /access_token|id_token|refresh_token|eyJ/;
const storageValues = (s: Storage): string[] => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('createUserManager', () => {
  it('uses the Authorization Code flow, silent renew, and an in-memory user store', () => {
    const um = createUserManager('http://localhost:8080/realms/queuepass', 'customer-app');
    expect(um.settings.response_type).toBe('code');
    expect(um.settings.client_id).toBe('customer-app');
    expect(um.settings.automaticSilentRenew).toBe(true);
    expect(um.settings.redirect_uri).toBe(`${window.location.origin}/`);
    expect(um.settings.post_logout_redirect_uri).toBe(`${window.location.origin}/`);
    expect((um.settings.userStore as unknown as { _store: unknown })._store).toBeInstanceOf(
      InMemoryWebStorage,
    );
  });

  it('never writes a token to localStorage or sessionStorage', async () => {
    const um = createUserManager('http://localhost:8080/realms/queuepass', 'customer-app');
    const fake = makeUser({ username: 'customer1', roles: ['customer'] });
    await um.storeUser(new User({ ...fake, profile: fake.profile }));
    expect((await um.getUser())?.profile.preferred_username).toBe('customer1');
    expect(storageValues(localStorage).filter((v) => TOKENISH.test(v))).toEqual([]);
    expect(storageValues(sessionStorage).filter((v) => TOKENISH.test(v))).toEqual([]);
  });
});

describe('AuthProvider', () => {
  it('redirects a signed-out visitor to sign-in and renders no children', async () => {
    const um = fakeUserManager(null);
    render(
      <AuthProvider userManager={um}>
        <p>secret content</p>
      </AuthProvider>,
    );
    await waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
    expect(screen.queryByText('secret content')).toBeNull();
  });

  it('asks to come back to the page the visitor opened', async () => {
    window.history.replaceState(null, '', '/locations?x=1');
    const um = fakeUserManager(null);
    render(
      <AuthProvider userManager={um}>
        <p>c</p>
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(um.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/locations?x=1' } }),
    );
  });

  it('completes the redirect callback, then removes the code from the URL', async () => {
    window.history.replaceState(null, '', '/?code=abc&state=xyz');
    const um = fakeUserManager(null);
    render(
      <AuthProvider userManager={um}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText(/status=signed-in user=callback-user roles=customer/);
    expect(um.signinRedirectCallback).toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('exposes the username and QueuePass roles from the access token', async () => {
    const um = fakeUserManager(
      makeUser({ username: 'admin1', roles: ['queuepass-admin', 'offline_access'] }),
    );
    render(
      <AuthProvider userManager={um}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('status=signed-in user=admin1 roles=queuepass-admin');
    expect(um.signinRedirect).not.toHaveBeenCalled();
  });

  it('treats an expired stored user as signed out', async () => {
    const um = fakeUserManager(
      makeUser({ username: 'admin1', roles: ['queuepass-admin'], expiresIn: -10 }),
    );
    render(
      <AuthProvider userManager={um}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
  });

  it('picks up a silently renewed user', async () => {
    const um = fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }));
    render(
      <AuthProvider userManager={um}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText(/user=admin1/);
    act(() =>
      um.emit(
        'userLoaded',
        makeUser({ username: 'admin1', roles: ['queuepass-admin', 'customer'] }),
      ),
    );
    await screen.findByText('status=signed-in user=admin1 roles=queuepass-admin,customer');
  });

  it('signs in again when Keycloak refuses the silent renew', async () => {
    const um = fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }));
    render(
      <AuthProvider userManager={um}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText(/user=admin1/);
    // Spec 018 research R12: only Keycloak's own refusal (an ErrorResponse) ends the session.
    await act(async () =>
      um.emit('silentRenewError', new ErrorResponse({ error: 'invalid_grant' })),
    );
    await waitFor(() => expect(um.calls.slice(-2)).toEqual(['removeUser', 'signinRedirect']));
  });

  it('re-checks when the page is restored from the back-forward cache with no user', async () => {
    const um = fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }));
    render(
      <AuthProvider userManager={um}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText(/user=admin1/);
    await um.removeUser();
    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: true });
    await act(async () => window.dispatchEvent(event));
    await waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
  });
});

/** Spec 015 FR-008 (research R8): the Customer app releases its reservations before signing out. */
describe('AuthProvider beforeLogout', () => {
  function LogoutProbe() {
    const auth = useAuth();
    return (
      <button type="button" onClick={() => void auth.logout()}>
        log out
      </button>
    );
  }

  const signedIn = () => fakeUserManager(makeUser({ username: 'customer1', roles: ['customer'] }));

  it('awaits beforeLogout, with the signed-in API client, before removing the user', async () => {
    const um = signedIn();
    let release!: () => void;
    const beforeLogout = vi.fn(
      (_api: ApiClient) =>
        new Promise<void>((resolve) => {
          um.calls.push('beforeLogout');
          release = resolve;
        }),
    );
    render(
      <AuthProvider userManager={um} beforeLogout={beforeLogout}>
        <LogoutProbe />
      </AuthProvider>,
    );
    const button = await screen.findByRole('button', { name: 'log out' });
    act(() => button.click());
    await waitFor(() => expect(beforeLogout).toHaveBeenCalledTimes(1));
    expect(beforeLogout.mock.calls[0][0]).toHaveProperty('POST');
    expect(um.removeUser).not.toHaveBeenCalled();

    await act(async () => release());

    await waitFor(() =>
      expect(um.calls.slice(-3)).toEqual(['beforeLogout', 'removeUser', 'signoutRedirect']),
    );
  });

  it('still signs out when beforeLogout rejects', async () => {
    const um = signedIn();
    const beforeLogout = vi.fn(async () => {
      throw new Error('offline');
    });
    render(
      <AuthProvider userManager={um} beforeLogout={beforeLogout}>
        <LogoutProbe />
      </AuthProvider>,
    );
    const button = await screen.findByRole('button', { name: 'log out' });
    await act(async () => button.click());

    await waitFor(() => expect(um.signoutRedirect).toHaveBeenCalled());
    expect(um.removeUser).toHaveBeenCalled();
  });

  it('still signs out after 2 seconds when beforeLogout never settles', async () => {
    const um = signedIn();
    const beforeLogout = vi.fn(() => new Promise<void>(() => {}));
    render(
      <AuthProvider userManager={um} beforeLogout={beforeLogout}>
        <LogoutProbe />
      </AuthProvider>,
    );
    await screen.findByRole('button', { name: 'log out' });
    vi.useFakeTimers();
    try {
      act(() => screen.getByRole('button', { name: 'log out' }).click());
      await act(async () => vi.advanceTimersByTimeAsync(1_999));
      expect(um.removeUser).not.toHaveBeenCalled();

      await act(async () => vi.advanceTimersByTimeAsync(1));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(um.signoutRedirect).toHaveBeenCalled());
  });

  it('signs out exactly as before without the prop', async () => {
    const um = signedIn();
    render(
      <AuthProvider userManager={um}>
        <LogoutProbe />
      </AuthProvider>,
    );
    const button = await screen.findByRole('button', { name: 'log out' });
    await act(async () => button.click());

    await waitFor(() => expect(um.calls.slice(-2)).toEqual(['removeUser', 'signoutRedirect']));
  });
});

/**
 * Spec 018 research R12 (FR-010, SC-006; spec 001 FR-013 as amended): a renewal that fails for
 * lack of network, or a token that simply expires, keeps the user in memory and retries quietly;
 * only Keycloak's own refusal (ErrorResponse) ends the session.
 */
describe('AuthProvider with no signal', () => {
  function Probes() {
    const auth = useAuth();
    return (
      <>
        <p>
          status={auth.status} user={auth.username ?? '-'}
        </p>
        <button type="button" onClick={() => void auth.logout()}>
          log out
        </button>
        <button type="button" onClick={() => void auth.signIn()}>
          got 401
        </button>
      </>
    );
  }

  const offline = () => new TypeError('Failed to fetch');
  const silentCalls = (um: ReturnType<typeof fakeUserManager>) =>
    um.calls.filter((c) => c === 'signinSilent').length;
  const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const goOnline = () => act(async () => void window.dispatchEvent(new Event('online')));
  const pageShow = () => {
    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: true });
    return act(async () => void window.dispatchEvent(event));
  };

  async function signedIn() {
    const um = fakeUserManager(makeUser({ username: 'customer1', roles: ['customer'] }));
    const view = render(
      <AuthProvider userManager={um}>
        <Probes />
      </AuthProvider>,
    );
    await screen.findByText('status=signed-in user=customer1');
    return { um, view };
  }

  /** The user is still in memory and the children are still mounted. */
  const expectKept = (um: ReturnType<typeof fakeUserManager>) => {
    expect(screen.getByText('status=signed-in user=customer1')).toBeInTheDocument();
    expect(um.removeUser).not.toHaveBeenCalled();
    expect(um.signinRedirect).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps the user when the renewal fails for lack of network', async () => {
    const { um } = await signedIn();
    await act(async () => um.emit('silentRenewError', offline()));
    await advance(1_000);
    expectKept(um);
  });

  it('keeps the user when the token expires with no renewal error before it', async () => {
    const { um } = await signedIn();
    await act(async () => um.emit('accessTokenExpired'));
    await advance(1_000);
    expectKept(um);
  });

  it.each(['silentRenewError', 'accessTokenExpired'] as const)(
    'after %s, retries every 30 seconds and on going online until it succeeds',
    async (first) => {
      const { um } = await signedIn();
      um.signinSilent.mockImplementation(async () => {
        um.calls.push('signinSilent');
        throw offline();
      });
      await act(async () => um.emit(first, first === 'silentRenewError' ? offline() : undefined));
      expect(silentCalls(um)).toBe(0);

      await advance(30_000);
      expect(silentCalls(um)).toBe(1);
      expectKept(um);
      await advance(30_000);
      expect(silentCalls(um)).toBe(2);
      await goOnline();
      expect(silentCalls(um)).toBe(3);
      expectKept(um);

      // Back online: the grant succeeds and raises userLoaded, which applies the user and stops.
      const fresh = makeUser({ username: 'customer1', roles: ['customer', 'gate-agent'] });
      um.signinSilent.mockImplementation(async () => {
        um.calls.push('signinSilent');
        um.storeUser(fresh);
        um.emit('userLoaded', fresh);
        return fresh;
      });
      await advance(30_000);
      expect(silentCalls(um)).toBe(4);
      await advance(60_000);
      await goOnline();
      expect(silentCalls(um)).toBe(4);
      expectKept(um);
    },
  );

  it('ends the session when Keycloak refuses a retry', async () => {
    const { um } = await signedIn();
    um.signinSilent.mockImplementation(async () => {
      um.calls.push('signinSilent');
      throw new ErrorResponse({ error: 'invalid_grant' });
    });
    await act(async () => um.emit('silentRenewError', offline()));
    await advance(30_000);
    await waitFor(() =>
      expect(um.calls.slice(-3)).toEqual(['signinSilent', 'removeUser', 'signinRedirect']),
    );
  });

  it('runs no retry with no failed renewal, on going online or after 60 seconds', async () => {
    const { um } = await signedIn();
    await goOnline();
    await advance(60_000);
    expect(silentCalls(um)).toBe(0);
  });

  it('runs no retry after unmounting', async () => {
    const { um, view } = await signedIn();
    await act(async () => um.emit('silentRenewError', offline()));
    view.unmount();
    await advance(60_000);
    await goOnline();
    expect(silentCalls(um)).toBe(0);
  });

  it('starts no second retry on going online while one is still pending', async () => {
    const { um } = await signedIn();
    um.signinSilent.mockImplementation(() => {
      um.calls.push('signinSilent');
      return new Promise<User | null>(() => {});
    });
    await act(async () => um.emit('accessTokenExpired'));
    await goOnline();
    expect(silentCalls(um)).toBe(1);
    await goOnline();
    await advance(30_000);
    expect(silentCalls(um)).toBe(1);
  });

  it('runs no retry while logging out', async () => {
    const { um } = await signedIn();
    await act(async () => um.emit('silentRenewError', offline()));
    await act(async () => screen.getByRole('button', { name: 'log out' }).click());
    await advance(60_000);
    await goOnline();
    expect(silentCalls(um)).toBe(0);
  });

  it('drops a renewal that lands during logout, so Back shows no signed-in page (001 SC-007)', async () => {
    const { um } = await signedIn();
    um.signinSilent.mockImplementation(() => {
      um.calls.push('signinSilent');
      return new Promise<User | null>(() => {});
    });
    await act(async () => um.emit('silentRenewError', offline()));
    await advance(30_000);
    expect(silentCalls(um)).toBe(1);

    await act(async () => screen.getByRole('button', { name: 'log out' }).click());
    await waitFor(() => expect(um.signoutRedirect).toHaveBeenCalled());

    // The pending grant answers after removeUser: the library stores the user and raises it.
    const late = makeUser({ username: 'customer1', roles: ['customer'] });
    um.storeUser(late);
    um.calls.push('late load');
    await act(async () => um.emit('userLoaded', late));

    expect(screen.queryByText(/status=signed-in/)).toBeNull();
    expect(um.calls.slice(um.calls.indexOf('late load'))).toContain('removeUser');
    await expect(um.getUser()).resolves.toBeNull();

    await pageShow();
    await waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
  });

  it.each([false, true])(
    'still signs in on a 401 (failed renewal before: %s)',
    async (failedFirst) => {
      const { um } = await signedIn();
      if (failedFirst) await act(async () => um.emit('silentRenewError', offline()));
      await act(async () => screen.getByRole('button', { name: 'got 401' }).click());
      expect(um.signinRedirect).toHaveBeenCalled();
    },
  );

  it('keeps an expired user restored from the back-forward cache, and retries', async () => {
    const { um } = await signedIn();
    um.storeUser(makeUser({ username: 'customer1', roles: ['customer'], expiresIn: -10 }));
    await pageShow();
    await advance(1_000);
    expectKept(um);
    await advance(30_000);
    expect(silentCalls(um)).toBe(1);
  });

  it('signs in when restored from the back-forward cache with no user', async () => {
    const { um } = await signedIn();
    um.storeUser(null);
    await pageShow();
    await waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
  });
});
