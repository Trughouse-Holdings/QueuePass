import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, RequireRole } from '@queuepass/shared/web';
import { App } from '../src/App';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

/** Spec 001 US2 for the Admin app: landing hello page, existing screens behind sign-in. */
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const renderAdmin = (roles: string[], at = '/') =>
  render(
    <AuthProvider userManager={fakeUserManager(makeUser({ username: 'admin1', roles }))}>
      <RequireRole role="queuepass-admin">
        <MemoryRouter initialEntries={[at]}>
          <App />
        </MemoryRouter>
      </RequireRole>
    </AuthProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('Admin app sign-in', () => {
  it('lands a signed-in admin on the hello page, with Venues, Events, and Log out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          app: 'admin',
          appName: 'QueuePass Admin',
          username: 'admin1',
          message: 'Hello, admin1! Welcome to QueuePass Admin.',
        }),
      ),
    );
    renderAdmin(['queuepass-admin']);

    expect(
      await screen.findByText('Hello, admin1! Welcome to QueuePass Admin.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Venues' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('sends the admin token on venue requests', async () => {
    const fetchMock = vi.fn(async (_req: Request) => json([]));
    vi.stubGlobal('fetch', fetchMock);
    renderAdmin(['queuepass-admin'], '/locations');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const req = fetchMock.mock.calls[0][0];
    expect(new URL(req.url).pathname).toBe('/locations');
    expect(req.headers.get('authorization')).toMatch(/^Bearer ey/);
  });

  it('shows a customer only the wrong-role message, even on a deep link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([])),
    );
    renderAdmin(['customer'], '/locations');

    expect(await screen.findByText("Your account can't use this app.")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Venues' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '/locations/6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e',
    '/events/b92fc02c-6013-470d-a3bf-bf53648b0ebc',
  ])('keeps the detail page %s from a customer, with no API call', async (at) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({})),
    );
    renderAdmin(['customer'], at);
    expect(await screen.findByText("Your account can't use this app.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
