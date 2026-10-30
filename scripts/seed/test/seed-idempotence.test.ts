import { describe, it, expect, beforeAll } from 'vitest';
import type KcAdminClient from '@keycloak/keycloak-admin-client';
import { seed } from '../src/index';
import { createKeycloakClient } from '../src/keycloak-client';
import { EXPECTED_COUNTS, USER_GROUPS } from '../src/provision-users';
import { FRONTEND_CLIENTS, AUDIENCE_SCOPE } from '../src/provision-clients';
import { LOGIN_THEME } from '../src/provision-realm';

/**
 * Spec 001 FR-004 through FR-007 and FR-034 — the seed must be idempotent AND deterministic,
 * for users and for the front-end sign-in clients.
 *
 * Requires a running Keycloak. Skipped when absent so the unit suite stays runnable without
 * the stack up; the quickstart runs it with Keycloak available.
 */
const realm = process.env.KEYCLOAK_REALM ?? 'queuepass';

// Keycloak 26 serves /health/* on the management port (9000), not 8080 (research R15).
const keycloakUp = async (): Promise<boolean> => {
  try {
    const res = await fetch(
      `${process.env.KEYCLOAK_HEALTH_URL ?? 'http://localhost:9000'}/health/ready`,
    );
    return res.ok;
  } catch {
    return false;
  }
};

// Spec 011 FR-014 (research R16): without Keycloak these tests report as skipped, with the reason.
const SKIP_REASON = 'Keycloak not reachable; start the stack to run seed idempotence tests';

describe('Keycloak seed idempotence', () => {
  let available = false;
  beforeAll(async () => {
    available = await keycloakUp();
    if (!available) {
      console.warn('[skip] Keycloak not reachable — start the stack to run seed idempotence tests');
    }
  });

  it('seeds exactly 235 users, and re-running changes nothing', async ({ skip }) => {
    skip(!available, SKIP_REASON);

    await seed();
    const first = await countUsers();

    expect(first.admin).toBe(EXPECTED_COUNTS.admin);
    expect(first.agent).toBe(EXPECTED_COUNTS.agent);
    expect(first.customer).toBe(EXPECTED_COUNTS.customer);
    expect(first.admin + first.agent + first.customer).toBe(235);

    await seed();
    expect(await countUsers()).toEqual(first);
  });

  it('converges the audience scope and three front-end clients, stably across runs', async ({
    skip,
  }) => {
    skip(!available, SKIP_REASON);

    await seed();
    const kc = await createKeycloakClient();
    const firstIds = await clientIds(kc);
    await seed();

    const scopes = (await kc.clientScopes.find({ realm })).filter((s) => s.name === AUDIENCE_SCOPE);
    expect(scopes).toHaveLength(1);
    const mappers = scopes[0].protocolMappers ?? [];
    expect(mappers).toHaveLength(1);
    expect(mappers[0].protocolMapper).toBe('oidc-audience-mapper');
    expect(mappers[0].config?.['included.custom.audience']).toBe('queuepass-api');
    expect(mappers[0].config?.['access.token.claim']).toBe('true');

    for (const { clientId, port } of FRONTEND_CLIENTS) {
      const found = await kc.clients.find({ realm, clientId });
      expect(found, clientId).toHaveLength(1);
      const c = found[0];
      expect(c.publicClient).toBe(true);
      expect(c.standardFlowEnabled).toBe(true);
      expect(c.directAccessGrantsEnabled).toBe(false);
      expect(c.implicitFlowEnabled).toBe(false);
      expect(c.serviceAccountsEnabled).toBe(false);
      expect(c.attributes?.['pkce.code.challenge.method']).toBe('S256');
      // Exact URIs, no wildcard (constitution, OIDC clients; research R6; #60).
      expect(c.redirectUris).toEqual([`http://localhost:${port}/`]);
      expect(c.webOrigins).toEqual([`http://localhost:${port}`]);
      expect(c.attributes?.['post.logout.redirect.uris']).toBe(`http://localhost:${port}/`);
      expect(c.attributes?.['use.refresh.tokens']).toBe('true');
      expectNoWildcard(c);

      const defaults = await kc.clients.listDefaultClientScopes({ realm, id: c.id! });
      const names = defaults.map((s) => s.name);
      expect(names).toContain(AUDIENCE_SCOPE);
      expect(names).toContain('roles');
    }

    // Updated in place, never deleted and recreated (research R6).
    expect(await clientIds(kc)).toEqual(firstIds);
  });

  it('repairs drift: a password grant switched on by hand is switched off again', async ({
    skip,
  }) => {
    skip(!available, SKIP_REASON);

    await seed();
    const kc = await createKeycloakClient();
    const [admin] = await kc.clients.find({ realm, clientId: 'admin-app' });
    await kc.clients.update(
      { realm, id: admin.id! },
      { ...admin, directAccessGrantsEnabled: true },
    );

    await seed();

    const [after] = await kc.clients.find({ realm, clientId: 'admin-app' });
    expect(after.directAccessGrantsEnabled).toBe(false);
  });

  it('repairs drift: a wildcard redirect URI set by hand is replaced by the exact list (#60)', async ({
    skip,
  }) => {
    skip(!available, SKIP_REASON);

    await seed();
    const kc = await createKeycloakClient();
    for (const { clientId, port } of FRONTEND_CLIENTS) {
      const [c] = await kc.clients.find({ realm, clientId });
      const origin = `http://localhost:${port}`;
      await kc.clients.update(
        { realm, id: c.id! },
        {
          ...c,
          redirectUris: [`${origin}/*`],
          attributes: { ...c.attributes, 'post.logout.redirect.uris': `${origin}/*` },
        },
      );
      const [drifted] = await kc.clients.find({ realm, clientId });
      expect(drifted.redirectUris, clientId).toEqual([`${origin}/*`]);
    }

    await seed();

    for (const { clientId, port } of FRONTEND_CLIENTS) {
      const [after] = await kc.clients.find({ realm, clientId });
      const origin = `http://localhost:${port}`;
      expect(after.redirectUris, clientId).toEqual([`${origin}/`]);
      expect(after.attributes?.['post.logout.redirect.uris'], clientId).toBe(`${origin}/`);
      expectNoWildcard(after);
    }
  });

  // Spec 021 FR-010, SC-004 (research R7): the sign-in look and the names arrive on a realm made
  // before them, and a second run leaves them in place.
  it('keeps the login theme and the Tickets name across runs', async ({ skip }) => {
    skip(!available, SKIP_REASON);

    await seed();
    await seed();
    const kc = await createKeycloakClient();
    expect((await kc.realms.findOne({ realm }))?.loginTheme).toBe(LOGIN_THEME);
    const [customer] = await kc.clients.find({ realm, clientId: 'customer-app' });
    expect(customer.name).toBe('QueuePass Tickets');
  });

  it('brings a realm from before spec 021 to the login theme and the new name, losing nothing', async ({
    skip,
  }) => {
    skip(!available, SKIP_REASON);

    await seed();
    const kc = await createKeycloakClient();
    const before = { users: await countUsers(), clients: await clientIds(kc) };
    await kc.realms.update({ realm }, { loginTheme: 'keycloak' });
    const [customer] = await kc.clients.find({ realm, clientId: 'customer-app' });
    await kc.clients.update({ realm, id: customer.id! }, { ...customer, name: 'QueuePass' });
    expect((await kc.realms.findOne({ realm }))?.loginTheme).toBe('keycloak');

    await seed();

    expect((await kc.realms.findOne({ realm }))?.loginTheme).toBe(LOGIN_THEME);
    const [after] = await kc.clients.find({ realm, clientId: 'customer-app' });
    expect(after.name).toBe('QueuePass Tickets');
    expect(await countUsers()).toEqual(before.users);
    expect(await clientIds(kc)).toEqual(before.clients);
  });
});

function expectNoWildcard(c: {
  clientId?: string;
  redirectUris?: string[];
  webOrigins?: string[];
  attributes?: Record<string, unknown>;
}): void {
  const uris = [
    ...(c.redirectUris ?? []),
    ...(c.webOrigins ?? []),
    // Keycloak joins several post-logout URIs into one attribute with "##".
    ...String(c.attributes?.['post.logout.redirect.uris'] ?? '').split('##'),
  ];
  for (const uri of uris) expect(uri, `${c.clientId}: ${uri}`).not.toContain('*');
}

async function clientIds(kc: KcAdminClient): Promise<Record<string, string | undefined>> {
  const ids: Record<string, string | undefined> = {};
  for (const { clientId } of FRONTEND_CLIENTS) {
    ids[clientId] = (await kc.clients.find({ realm, clientId }))[0]?.id;
  }
  return ids;
}

async function countUsers(): Promise<{ admin: number; agent: number; customer: number }> {
  const kc = await createKeycloakClient();
  const counts = { admin: 0, agent: 0, customer: 0 };

  for (const group of USER_GROUPS) {
    const found = await kc.users.find({ realm, username: group.prefix, max: 1000 });
    const exact = found.filter((u) => new RegExp(`^${group.prefix}\\d+$`).test(u.username ?? ''));
    counts[group.key] = exact.length;
  }
  return counts;
}
