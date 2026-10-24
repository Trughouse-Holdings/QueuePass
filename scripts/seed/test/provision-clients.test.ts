import { describe, it, expect } from 'vitest';
import { FRONTEND_CLIENTS, desiredClient } from '../src/provision-clients';

/**
 * Spec 001 FR-005 and research R6 (issue #60): each front-end client lists exactly the one URI
 * its front end uses, `${origin}/`, for sign-in and for logout. The constitution forbids
 * wildcards in redirect URIs. Pure: needs no Keycloak.
 */
describe('desired front-end client settings', () => {
  it('covers the three front ends on their own ports', () => {
    expect(FRONTEND_CLIENTS.map((c) => [c.clientId, c.port])).toEqual([
      ['admin-app', 5173],
      ['customer-app', 5174],
      ['booth-app', 5175],
    ]);
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
});
