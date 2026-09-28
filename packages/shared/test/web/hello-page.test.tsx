import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../../src/web/auth-provider';
import { HelloPage } from '../../src/web/hello-page';
import { fakeUserManager, makeUser } from './fake-user-manager';

/** Spec 001 FR-012, FR-014, FR-017. */
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const user = makeUser({ username: 'customer1', roles: ['customer'] });
const renderHello = (um = fakeUserManager(user)) => {
  render(
    <AuthProvider userManager={um} apiBaseUrl="http://api.test">
      <HelloPage greetingPath="/hello/customer" />
    </AuthProvider>,
  );
  return um;
};

afterEach(() => vi.unstubAllGlobals());

describe('HelloPage', () => {
  it('calls the greeting with the user’s own bearer token and shows it', async () => {
    const fetchMock = vi.fn(async (_req: Request) =>
      json({
        app: 'customer',
        appName: 'QueuePass',
        username: 'customer1',
        message: 'Hello, customer1! Welcome to QueuePass.',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderHello();

    expect(await screen.findByRole('heading', { name: 'QueuePass' })).toBeInTheDocument();
    expect(screen.getByText('Hello, customer1! Welcome to QueuePass.')).toBeInTheDocument();
    const req = fetchMock.mock.calls[0][0];
    expect(req.url).toBe('http://api.test/hello/customer');
    expect(req.headers.get('authorization')).toBe(`Bearer ${user.access_token}`);
  });

  it('says plainly when the Backend cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderHello();
    expect(await screen.findByText("Can't reach the QueuePass service.")).toBeInTheDocument();
  });

  it('signs in again when the Backend says the token is no longer valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401)),
    );
    const um = renderHello();
    await waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
  });

  it('shows the wrong-role message when the Backend refuses the role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'FORBIDDEN', message: 'x' } }, 403)),
    );
    renderHello();
    expect(await screen.findByText("Your account can't use this app.")).toBeInTheDocument();
  });
});
