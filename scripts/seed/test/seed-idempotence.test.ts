import { describe, it, expect, beforeAll } from 'vitest';
import type KcAdminClient from '@keycloak/keycloak-admin-client';
import { seed } from '../src/index';
import { APP_REALMS, LEGACY_REALM } from '../src/app-realms';
import { createKeycloakClient } from '../src/keycloak-client';
import { FRONTEND_CLIENTS, AUDIENCE_SCOPE } from '../src/provision-clients';
import { LOGIN_THEME } from '../src/provision-realm';
import { liveSkipReason } from './live-guard';

/**
 * Spec 001 FR-004 through FR-007 and FR-034 — the seed must be idempotent AND deterministic,
 * for users and for the front-end sign-in clients; spec 028 FR-005, FR-009 (tasks T015): in each
 * of the three app realms, each holding its own users and its one client.
 *
 * Requires a running Keycloak. Skipped when absent so the unit suite stays runnable without
 * the stack up; the quickstart runs it with Keycloak available. Also skipped on a Keycloak that
 * still has realm `queuepass`, which `seed()` would rename, unless QP_SEED_ALLOW_RENAME=1 (spec 028
 * research R13).
 */

// Spec 011 FR-014 (research R16): without Keycloak these tests report as skipped, with the reason.
const UNREACHABLE = 'Keycloak not reachable; start the stack to run seed idempotence tests';

type Counts = Record<string, number>;

describe('Keycloak seed idempotence', () => {
  let skipReason: string | undefined;
  beforeAll(async () => {
    skipReason = await liveSkipReason(UNREACHABLE);
    if (skipReason) console.warn(`[skip] ${skipReason}`);
  });

  it('seeds each app realm with exactly its users, 235 in all, and re-running changes nothing', async ({
    skip,
  }) => {
    skip(!!skipReason, skipReason);

    await seed();
    const first = await countUsers();

    expect(first).toEqual({
      'queuepass-admin-app': 5,
      'queuepass-customer-app': 200,
      'queuepass-booth-app': 30,
    });
    const kc = await createKeycloakClient();
    expect((await kc.realms.find()).map((r) => r.realm)).not.toContain(LEGACY_REALM);

    await seed();
    expect(await countUsers()).toEqual(first);
  });

  it("converges each realm's audience scope and its one front-end client, stably across runs", async ({
    skip,
  }) => {
    skip(!!skipReason, skipReason);

    await seed();
    const kc = await createKeycloakClient();
    const firstIds = await clientIds(kc);
    await seed();

    for (const { realm, clientId } of APP_REALMS) {
      const scopes = (await kc.clientScopes.find({ realm })).filter(
        (s) => s.name === AUDIENCE_SCOPE,
      );
      expect(scopes, realm).toHaveLength(1);
      const mappers = scopes[0]!.protocolMappers ?? [];
      expect(mappers).toHaveLength(1);
      expect(mappers[0]!.protocolMapper).toBe('oidc-audience-mapper');
      expect(mappers[0]!.config?.['included.custom.audience']).toBe('queuepass-api');
      expect(mappers[0]!.config?.['access.token.claim']).toBe('true');

      // Only its own app's client is enabled in the realm.
      const others = FRONTEND_CLIENTS.filter((c) => c.clientId !== clientId);
      for (const other of others) {
        const [found] = await kc.clients.find({ realm, clientId: other.clientId });
        expect(found?.enabled ?? false, `${realm} ${other.clientId}`).toBe(false);
      }

      const { port } = FRONTEND_CLIENTS.find((c) => c.clientId === clientId)!;
      const found = await kc.clients.find({ realm, clientId });
      expect(found, clientId).toHaveLength(1);
      const c = found[0]!;
      expect(c.enabled).toBe(true);
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
    skip(!!skipReason, skipReason);

    await seed();
    const kc = await createKeycloakClient();
    const realm = APP_REALMS[0].realm;
    const [admin] = await kc.clients.find({ realm, clientId: 'admin-app' });
    await kc.clients.update(
      { realm, id: admin!.id! },
      { ...admin, directAccessGrantsEnabled: true },
    );

    await seed();

    const [after] = await kc.clients.find({ realm, clientId: 'admin-app' });
    expect(after!.directAccessGrantsEnabled).toBe(false);
  });

  it('repairs drift: a wildcard redirect URI set by hand is replaced by the exact list (#60)', async ({
    skip,
  }) => {
    skip(!!skipReason, skipReason);

    await seed();
    const kc = await createKeycloakClient();
    for (const { realm, clientId } of APP_REALMS) {
      const { port } = FRONTEND_CLIENTS.find((c) => c.clientId === clientId)!;
      const [c] = await kc.clients.find({ realm, clientId });
      const origin = `http://localhost:${port}`;
      await kc.clients.update(
        { realm, id: c!.id! },
        {
          ...c,
          redirectUris: [`${origin}/*`],
          attributes: { ...c!.attributes, 'post.logout.redirect.uris': `${origin}/*` },
        },
      );
      const [drifted] = await kc.clients.find({ realm, clientId });
      expect(drifted!.redirectUris, clientId).toEqual([`${origin}/*`]);
    }

    await seed();

    for (const { realm, clientId } of APP_REALMS) {
      const { port } = FRONTEND_CLIENTS.find((c) => c.clientId === clientId)!;
      const [after] = await kc.clients.find({ realm, clientId });
      const origin = `http://localhost:${port}`;
      expect(after!.redirectUris, clientId).toEqual([`${origin}/`]);
      expect(after!.attributes?.['post.logout.redirect.uris'], clientId).toBe(`${origin}/`);
      expectNoWildcard(after!);
    }
  });

  // Spec 021 FR-010, SC-004 (research R7); spec 028 FR-008: every app realm has the sign-in look
  // and the QueuePass name, and the Customer app's client the Tickets name, across runs.
  it('keeps the login theme, the QueuePass name and the Tickets name across runs', async ({
    skip,
  }) => {
    skip(!!skipReason, skipReason);

    await seed();
    await seed();
    const kc = await createKeycloakClient();
    for (const { realm } of APP_REALMS) {
      const rep = await kc.realms.findOne({ realm });
      expect(rep?.loginTheme, realm).toBe(LOGIN_THEME);
      expect(rep?.displayName, realm).toBe('QueuePass');
      expect(rep?.enabled, realm).toBe(true);
    }
    const realm = APP_REALMS[1].realm;
    const [customer] = await kc.clients.find({ realm, clientId: 'customer-app' });
    expect(customer!.name).toBe('QueuePass Tickets');
  });

  it('brings a realm with another login theme back to the sign-in look, losing nothing', async ({
    skip,
  }) => {
    skip(!!skipReason, skipReason);

    await seed();
    const kc = await createKeycloakClient();
    const before = { users: await countUsers(), clients: await clientIds(kc) };
    for (const { realm } of APP_REALMS) {
      await kc.realms.update({ realm }, { loginTheme: 'keycloak' });
      expect((await kc.realms.findOne({ realm }))?.loginTheme).toBe('keycloak');
    }
    const customerRealm = APP_REALMS[1].realm;
    const [customer] = await kc.clients.find({ realm: customerRealm, clientId: 'customer-app' });
    await kc.clients.update(
      { realm: customerRealm, id: customer!.id! },
      { ...customer, name: 'QueuePass' },
    );

    await seed();

    for (const { realm } of APP_REALMS) {
      expect((await kc.realms.findOne({ realm }))?.loginTheme, realm).toBe(LOGIN_THEME);
    }
    const [after] = await kc.clients.find({ realm: customerRealm, clientId: 'customer-app' });
    expect(after!.name).toBe('QueuePass Tickets');
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

/** Each app realm's own client's internal id. */
async function clientIds(kc: KcAdminClient): Promise<Record<string, string | undefined>> {
  const ids: Record<string, string | undefined> = {};
  for (const { realm, clientId } of APP_REALMS) {
    ids[realm] = (await kc.clients.find({ realm, clientId }))[0]?.id;
  }
  return ids;
}

/** Each app realm's enabled users with its app role's names (`admin1`…, `customer1`…). */
async function countUsers(): Promise<Counts> {
  const kc = await createKeycloakClient();
  const counts: Counts = {};
  for (const { realm, prefix } of APP_REALMS) {
    const found = await kc.users.find({ realm, username: prefix, max: 1000 });
    counts[realm] = found.filter(
      (u) => u.enabled && new RegExp(`^${prefix}\\d+$`).test(u.username ?? ''),
    ).length;
  }
  return counts;
}
