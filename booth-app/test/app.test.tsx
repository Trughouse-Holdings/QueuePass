import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

/** Spec 001 US2: sign-in gate, hello-world page, wrong-role refusal, and logout for this app. */
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('QueuePass Ticket Booth app', () => {
  it('greets a gate-agent user from the Backend and offers logout', async () => {
    const fetchMock = vi.fn(async (_req: Request) =>
      json({
        app: 'booth',
        appName: 'QueuePass Ticket Booth',
        username: 'agent1',
        message: 'Hello, agent1! Welcome to QueuePass Ticket Booth.',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <App
        userManager={fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }))}
      />,
    );

    expect(
      await screen.findByText('Hello, agent1! Welcome to QueuePass Ticket Booth.'),
    ).toBeInTheDocument();
    expect(new URL(fetchMock.mock.calls[0][0].url).pathname).toBe('/hello/booth');
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('refuses a customer user and shows no greeting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({})),
    );
    render(
      <App userManager={fakeUserManager(makeUser({ username: 'someone', roles: ['customer'] }))} />,
    );

    expect(await screen.findByText("Your account can't use this app.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows nothing but "Signing in…" to a signed-out visitor', () => {
    render(<App userManager={fakeUserManager(null)} />);
    expect(screen.getByText('Signing in…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });
});
