import { describe, it, expect } from 'vitest';
import { FRONTEND_CLIENTS, desiredClient } from '../src/provision-clients';

/**
 * Spec 001 FR-005 and research R6 (issue #60): each front-end client lists exactly the one URI
 * its front end uses, `${origin}/`, for sign-in and for logout. The constitution forbids
 * wildcards in redirect URIs. Pure: needs no Keycloak.
 */
describe('desired front-end client settings', () => {
  it('covers the five front ends on their own ports (037: Rust Admin 5176; 040: Rust Customer 5177)', () => {
    expect(FRONTEND_CLIENTS.map((c) => [c.clientId, c.port])).toEqual([
      ['admin-app', 5173],
      ['customer-app', 5174],
      ['booth-app', 5175],
      ['admin-rust-app', 5176],
      ['customer-rust-app', 5177],
    ]);
  });

  // Spec 021 FR-002: the name each sign-in screen shows comes from here, and only from here.
  it('names the five front ends as their sign-in screens do', () => {
    expect(FRONTEND_CLIENTS.map((c) => [c.clientId, c.name])).toEqual([
      ['admin-app', 'QueuePass Admin'],
      ['customer-app', 'QueuePass Tickets'],
      ['booth-app', 'QueuePass Ticket Booth'],
      ['admin-rust-app', 'QueuePass Admin (Rust)'],
      ['customer-rust-app', 'QueuePass Tickets (Rust)'],
    ]);
    for (const c of FRONTEND_CLIENTS) expect(desiredClient(c).name).toBe(c.name);
  });

  for (const c of FRONTEND_CLIENTS) {
    const origin = `http://localhost:${c.port}`;

    it(`${c.clientId}: exact redirect, post-logout and web origin, no wildcard`, () => {
      const d = desiredClient(c);
      expect(d.redirectUris).toEqual([`${origin}/`]);
      expect(d.attributes?.['post.logout.redirect.uris']).toBe(`${origin}/`);
      expect(d.webOrigins).toEqual([origin]);
      // Renewal uses the refresh token; without one there is no silent-renew page to fall back on.
      expect(d.attributes?.['use.refresh.tokens']).toBe('true');

      const all = [
        ...(d.redirectUris ?? []),
        ...(d.webOrigins ?? []),
        // Keycloak stores several post-logout URIs as one attribute joined by "##".
        ...String(d.attributes?.['post.logout.redirect.uris'] ?? '').split('##'),
      ];
      for (const uri of all) expect(uri, uri).not.toContain('*');
    });
  }

  // Spec 040 (contract sign-in-client.md): the Rust Customer app's client, pinned to its values.
  it('customer-rust-app: public, PKCE S256 only, no direct grants, exact URIs on 5177', () => {
    const c = FRONTEND_CLIENTS.find((f) => f.clientId === 'customer-rust-app')!;
    const d = desiredClient(c);
    expect(d).toMatchObject({
      clientId: 'customer-rust-app',
      name: 'QueuePass Tickets (Rust)',
      enabled: true,
      protocol: 'openid-connect',
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      implicitFlowEnabled: false,
      serviceAccountsEnabled: false,
      frontchannelLogout: true,
      redirectUris: ['http://localhost:5177/'],
      webOrigins: ['http://localhost:5177'],
    });
    expect(d.attributes).toMatchObject({
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': 'http://localhost:5177/',
      'use.refresh.tokens': 'true',
    });
  });
});
