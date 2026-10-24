import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

/**
 * Spec 001 US2, kept by spec 017: the sign-in gate, the wrong-role refusal, and logout. The
 * hello-world greeting is gone (T013); the signed-in flow is check-in.test.tsx's job.
 */
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('QueuePass Ticket Booth app', () => {
  it('shows a gate agent the event choice, not a hello-world greeting, and offers logout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([])),
    );
    render(
      <App
        userManager={fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }))}
      />,
    );

    expect(await screen.findByText(/Choose the event/)).toBeInTheDocument();
    expect(screen.queryByText(/Hello, agent1/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('refuses a customer user and shows no data', async () => {
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
