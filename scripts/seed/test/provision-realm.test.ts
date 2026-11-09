import { describe, it, expect, vi, afterEach } from 'vitest';
import type KcAdminClient from '@keycloak/keycloak-admin-client';
import type RealmRepresentation from '@keycloak/keycloak-admin-client/lib/defs/realmRepresentation';
import { APP_REALMS } from '../src/app-realms';
import { LOGIN_THEME, provisionRealm } from '../src/provision-realm';

/**
 * Spec 021 research R7 (FR-009, FR-010): the seed sets the realm's login theme on create and
 * converges it on every run, changing nothing when it is already in place; spec 028 (FR-008,
 * tasks T015): in each app realm. A fake Keycloak admin client: needs no Keycloak.
 */

interface Fake {
  kc: KcAdminClient;
  created: RealmRepresentation[];
  updates: { query: { realm: string }; rep: RealmRepresentation }[];
}

/** A fake client holding `existing` as the realm, or no realm when it is undefined. */
function fake(role: string, existing?: RealmRepresentation): Fake {
  const created: RealmRepresentation[] = [];
  const updates: Fake['updates'] = [];
  const kc = {
    realms: {
      find: async () => (existing ? [existing] : []),
      findOne: async ({ realm: name }: { realm: string }) =>
        existing && existing.realm === name ? existing : undefined,
      create: async (rep: RealmRepresentation) => {
        created.push(rep);
        return { realmName: rep.realm! };
      },
      update: async (query: { realm: string }, rep: RealmRepresentation) => {
        updates.push({ query, rep });
      },
    },
    roles: {
      find: async () => [{ name: role }],
      create: async () => ({ roleName: '' }),
    },
  } as unknown as KcAdminClient;
  return { kc, created, updates };
}

/** The seed's log lines during `run`. */
async function logged(run: () => Promise<void>): Promise<string[]> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await run();
  return log.mock.calls.map((c) => String(c[0]));
}

afterEach(() => vi.restoreAllMocks());

describe.each(APP_REALMS.map((r) => [r.realm, r.role] as const))(
  'the realm login theme (research R7): %s',
  (realm, role) => {
    it("is named 'queuepass'", () => {
      expect(LOGIN_THEME).toBe('queuepass');
    });

    it('creates a new realm with the login theme and the settings it has today', async () => {
      const f = fake(role);
      await logged(() => provisionRealm(f.kc, realm, role));
      expect(f.created).toHaveLength(1);
      expect(f.created[0]).toMatchObject({
        realm,
        loginTheme: 'queuepass',
        displayName: 'QueuePass',
        registrationAllowed: false,
      });
      expect(f.updates).toEqual([]);
    });

    it.each([
      ['no login theme', undefined],
      ['the stock login theme', 'keycloak'],
    ])(
      'sets the login theme, and only it, on an existing realm with %s (FR-010)',
      async (_, theme) => {
        const f = fake(role, { realm, displayName: 'QueuePass', loginTheme: theme });
        const lines = await logged(() => provisionRealm(f.kc, realm, role));
        expect(f.created).toEqual([]);
        expect(f.updates).toEqual([{ query: { realm }, rep: { loginTheme: 'queuepass' } }]);
        expect(lines).toContain(`[seed] ${realm}: set login theme 'queuepass'`);
      },
    );

    it('changes nothing on a realm already at the login theme, and says so (FR-010)', async () => {
      const f = fake(role, { realm, displayName: 'QueuePass', loginTheme: 'queuepass' });
      const lines = await logged(() => provisionRealm(f.kc, realm, role));
      expect(f.created).toEqual([]);
      expect(f.updates).toEqual([]);
      expect(lines).toContain(`[seed] ${realm}: login theme already 'queuepass'`);
    });
  },
);
