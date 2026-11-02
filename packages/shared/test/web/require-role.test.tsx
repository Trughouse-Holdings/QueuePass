import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider } from '../../src/web/auth-provider';
import { RequireRole } from '../../src/web/require-role';
import { fakeUserManager, makeUser } from './fake-user-manager';

/** Spec 001 FR-016, US2-6, US2-7. */
const renderAs = (
  user: ReturnType<typeof makeUser> | null,
  role: Parameters<typeof RequireRole>[0]['role'],
) =>
  render(
    <AuthProvider userManager={fakeUserManager(user)}>
      <RequireRole role={role}>
        <p>app content</p>
      </RequireRole>
    </AuthProvider>,
  );

describe('RequireRole', () => {
  it('shows "Signing in…" while loading, and no content', () => {
    renderAs(null, 'customer');
    expect(screen.getByText('Signing in…')).toBeInTheDocument();
    expect(screen.queryByText('app content')).toBeNull();
  });

  it('renders the app for a user with the required role', async () => {
    renderAs(makeUser({ username: 'customer1', roles: ['customer'] }), 'customer');
    expect(await screen.findByText('app content')).toBeInTheDocument();
  });

  it('shows only a plain refusal and a logout button for the wrong role', async () => {
    renderAs(makeUser({ username: 'customer1', roles: ['customer'] }), 'queuepass-admin');
    expect(await screen.findByText("Your account can't use this app.")).toBeInTheDocument();
    expect(screen.getByText(/customer1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.queryByText('app content')).toBeNull();
  });

  // Issue #37: the refusal wears the shared theme (spec 012), in every app: the theme's page
  // layout, a card, and a theme button, with its text unchanged.
  it('shows the refusal in the theme: the page layout, a card, and a theme button', async () => {
    renderAs(makeUser({ username: 'customer1', roles: ['customer'] }), 'queuepass-admin');
    const text = await screen.findByText("Your account can't use this app.");
    const main = screen.getByRole('main');
    expect(main).toHaveClass('main');
    expect(main.parentElement).toHaveClass('app');
    expect(text.closest('.card')).not.toBeNull();
    expect(main).toContainElement(text.closest('.card') as HTMLElement);
    expect(screen.getByRole('button', { name: 'Log out' })).toHaveClass('btn', 'btn--primary');
    // Review round 1, S3: the refusal is the page's heading.
    expect(
      screen.getByRole('heading', { level: 1, name: "Your account can't use this app." }),
    ).toHaveClass('page-title');
  });

  it.each([
    ['customer', true],
    ['gate-agent', true],
    ['queuepass-admin', false],
  ] as const)('with roles customer+gate-agent, the %s gate admits: %s', async (role, admitted) => {
    renderAs(makeUser({ username: 'multi1', roles: ['customer', 'gate-agent'] }), role);
    if (admitted) expect(await screen.findByText('app content')).toBeInTheDocument();
    else expect(await screen.findByText("Your account can't use this app.")).toBeInTheDocument();
  });
});
