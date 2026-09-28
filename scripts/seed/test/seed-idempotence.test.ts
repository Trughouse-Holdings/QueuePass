import { describe, it, expect, beforeAll } from 'vitest';
import type KcAdminClient from '@keycloak/keycloak-admin-client';
import { seed } from '../src/index';
import { createKeycloakClient } from '../src/keycloak-client';
import { EXPECTED_COUNTS, USER_GROUPS } from '../src/provision-users';
import { FRONTEND_CLIENTS, AUDIENCE_SCOPE } from '../src/provision-clients';

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

describe('Keycloak seed idempotence', () => {
  let available = false;
  beforeAll(async () => {
    available = await keycloakUp();
    if (!available) {
      console.warn('[skip] Keycloak not reachable — start the stack to run seed idempotence tests');
    }
  });

  it('seeds exactly 235 users, and re-running changes nothing', async () => {
    if (!available) return;

    await seed();
    const first = await countUsers();

    expect(first.admin).toBe(EXPECTED_COUNTS.admin);
    expect(first.agent).toBe(EXPECTED_COUNTS.agent);
    expect(first.customer).toBe(EXPECTED_COUNTS.customer);
    expect(first.admin + first.agent + first.customer).toBe(235);

    await seed();
    expect(await countUsers()).toEqual(first);
  });

  it('converges the audience scope and three front-end clients, stably across runs', async () => {
    if (!available) return;

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
      expect(c.redirectUris).toEqual([`http://localhost:${port}/*`]);
      expect(c.webOrigins).toEqual([`http://localhost:${port}`]);
      expect(c.attributes?.['post.logout.redirect.uris']).toBe(`http://localhost:${port}/*`);

      const defaults = await kc.clients.listDefaultClientScopes({ realm, id: c.id! });
      const names = defaults.map((s) => s.name);
      expect(names).toContain(AUDIENCE_SCOPE);
      expect(names).toContain('roles');
    }

    // Updated in place, never deleted and recreated (research R6).
    expect(await clientIds(kc)).toEqual(firstIds);
  });

  it('repairs drift: a password grant switched on by hand is switched off again', async () => {
    if (!available) return;

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
});

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
