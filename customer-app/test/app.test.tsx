import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { availability, event, json, renderCustomer, stubApi, venue } from './helpers';

/**
 * Spec 001 US2, spec 003 US3, and spec 006 FR-009: the sign-in gate, wrong-role refusal, and
 * logout, and a Customer app whose only write is placing an order.
 */
afterEach(() => vi.unstubAllGlobals());

const everyRoute = () =>
  stubApi({
    'GET /events': json([event()]),
    'GET /events/e1': json(event()),
    'GET /events/e1/availability': json(availability()),
    'GET /events/e1/tiers': json([]),
    'GET /locations': json([venue()]),
    'GET /locations/v1': json(venue()),
  });

describe('Customer app sign-in', () => {
  it('shows a signed-in customer Events, Venues, and Log out', async () => {
    everyRoute();
    renderCustomer();

    expect(await screen.findByRole('link', { name: 'Events' })).toHaveAttribute('href', '/events');
    expect(screen.getByRole('link', { name: 'Venues' })).toHaveAttribute('href', '/venues');
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('logs out through Keycloak', async () => {
    everyRoute();
    const { um } = renderCustomer();
    (await screen.findByRole('button', { name: 'Log out' })).click();
    await vi.waitFor(() => expect(um.calls).toContain('signoutRedirect'));
    expect(um.calls.indexOf('removeUser')).toBeLessThan(um.calls.indexOf('signoutRedirect'));
  });

  it.each(['queuepass-admin', 'gate-agent'])(
    'refuses a %s user on a venue page and asks the Backend for nothing',
    async (role) => {
      const { calls } = everyRoute();
      renderCustomer({ at: '/venues/v1', roles: [role], username: 'someone' });

      expect(await screen.findByText("Your account can't use this app.")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
      expect(screen.queryByText('Alpha Arena')).toBeNull();
      expect(calls).toHaveLength(0);
    },
  );

  it('shows a signed-out visitor nothing but "Signing in…"', () => {
    const { calls } = everyRoute();
    renderCustomer({ at: '/venues/v1', signedIn: false });

    expect(screen.getByText('Signing in…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('Customer app changes no venue, event, or tier (spec 003 US3-1; spec 006 FR-009)', () => {
  it.each(['/', '/events/e1', '/venues', '/venues/v1'])(
    'offers no change control at %s and sends only GETs',
    async (at) => {
      const { calls } = everyRoute();
      renderCustomer({ at });

      expect(await screen.findAllByText(/Alpha Arena/)).not.toHaveLength(0);
      const changeWord = /\b(add|new|edit|save|delete|schedule|create|update|remove)\b/i;
      expect(screen.queryAllByRole('button', { name: changeWord })).toHaveLength(0);
      expect(screen.queryAllByRole('link', { name: changeWord })).toHaveLength(0);
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
    },
  );

  it('shows a plain message for an unknown address', async () => {
    everyRoute();
    renderCustomer({ at: '/nowhere' });
    expect(await screen.findByText('Page not found.')).toBeInTheDocument();
  });
});
