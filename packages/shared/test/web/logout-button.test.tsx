import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../../src/web/auth-provider';
import { LogoutButton } from '../../src/web/logout-button';
import { fakeUserManager, makeUser } from './fake-user-manager';

/** Spec 001 FR-015, US2-4, US2-5; research R2. */
describe('LogoutButton', () => {
  it('clears the in-memory user BEFORE ending the Keycloak session', async () => {
    const user = makeUser({ username: 'admin1', roles: ['queuepass-admin'] });
    const um = fakeUserManager(user);
    render(
      <AuthProvider userManager={um}>
        <LogoutButton />
      </AuthProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(um.signoutRedirect).toHaveBeenCalled());
    expect(um.calls.filter((c) => c === 'removeUser' || c === 'signoutRedirect')).toEqual([
      'removeUser',
      'signoutRedirect',
    ]);
    expect(um.signoutRedirect).toHaveBeenCalledWith({
      id_token_hint: user.id_token,
      post_logout_redirect_uri: `${window.location.origin}/`,
    });
  });

  it('does not start a new sign-in while logging out', async () => {
    const um = fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }));
    render(
      <AuthProvider userManager={um}>
        <LogoutButton />
      </AuthProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(um.signoutRedirect).toHaveBeenCalled());
    expect(um.signinRedirect).not.toHaveBeenCalled();
  });
});
