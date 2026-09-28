import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { InMemoryWebStorage, User } from 'oidc-client-ts';
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

  it('signs in again when silent renew fails', async () => {
    const um = fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }));
    render(
      <AuthProvider userManager={um}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText(/user=admin1/);
    await act(async () => um.emit('silentRenewError', new Error('refresh failed')));
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
