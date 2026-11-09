import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeKeycloak, newRealm, type FakeKeycloak } from './fake-keycloak';
import { legacyState } from './legacy-state';

/**
 * Spec 028 FR-009 and the Edge Cases (research R6; tasks T014): the rename's edges. Both realms
 * present: the seed stops, naming both and how to recover, and changes nothing. A run cut short
 * right after the rename is finished by the next. A customer deleted by hand after the rename is
 * made again, with a new id, and the log says so. Needs no Keycloak (a recording fake).
 */
const client = vi.hoisted(() => ({ fake: undefined as FakeKeycloak | undefined }));

vi.mock('../src/keycloak-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/keycloak-client')>()),
  waitForKeycloak: async () => undefined,
  createKeycloakClient: async () => client.fake!.kc,
}));

const CUSTOMER = 'queuepass-customer-app';
/** Every admin API call that changes something. */
const WRITES =
  /\.(create|update|del|add|addRealmRoleMappings|addDefaultClientScope|addProtocolMapper|delProtocolMapper)$/;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function seed(): Promise<void> {
  const { seed: run } = await import('../src/index');
  await run();
}

describe('the rename, at its edges', () => {
  describe('(a, d) realm queuepass and the customer realm both present', () => {
    const both = () => {
      const state = legacyState();
      state.realms.push(newRealm({ realm: CUSTOMER }));
      return state;
    };

    it('fails naming both realms, and changes nothing (FR-009)', async () => {
      const state = both();
      const before = structuredClone(state);
      client.fake = createFakeKeycloak(state);

      await expect(seed()).rejects.toThrow(
        "Both realm 'queuepass' and realm 'queuepass-customer-app' exist",
      );

      expect(state).toEqual(before);
      expect(client.fake.methods().filter((m) => WRITES.test(m))).toEqual([]);
    });

    it('says how to recover: rename the extra queuepass aside, never delete it', async () => {
      client.fake = createFakeKeycloak(both());

      await expect(seed()).rejects.toThrow(
        "To recover, rename the extra 'queuepass' aside in Keycloak's admin console " +
          "(Realm settings, for example to 'queuepass-recreated'); never delete it. " +
          'Then run the seed again.',
      );
    });
  });

  it('(b) a run stopped right after the rename is finished by the next run', async () => {
    const state = legacyState();
    client.fake = createFakeKeycloak(state);
    client.fake.stopAfter('realms.update');

    await expect(seed()).rejects.toThrow('fake Keycloak: stopped after realms.update (test)');
    // The rename is done, nothing after it: the old copies are still enabled.
    expect(state.realms.map((r) => r.rep.realm)).toEqual([CUSTOMER]);
    expect(state.realms[0]!.users.filter((u) => u.enabled === false)).toEqual([]);

    client.fake = createFakeKeycloak(state);
    await seed();

    expect(state.realms.map((r) => r.rep.realm).sort()).toEqual([
      'queuepass-admin-app',
      'queuepass-booth-app',
      CUSTOMER,
    ]);
    const customerRealm = client.fake.realm(CUSTOMER);
    expect(customerRealm.users.filter((u) => u.enabled === false)).toHaveLength(35);
    expect(customerRealm.clients.filter((c) => c.enabled === false).map((c) => c.clientId)).toEqual(
      ['admin-app', 'booth-app'],
    );
    expect(client.fake.realm('queuepass-admin-app').users).toHaveLength(5);
    expect(client.fake.realm('queuepass-booth-app').users).toHaveLength(30);
    // The second run renamed nothing: there was nothing left to rename.
    expect(client.fake.callsTo('realms.update')).toEqual([]);
  });

  it('(c) a customer deleted by hand after the rename is made again, with a new id, and logged', async () => {
    const state = legacyState();
    client.fake = createFakeKeycloak(state);
    await seed();
    // By hand, in the admin console: customer7 is gone.
    const realm = client.fake.realm(CUSTOMER);
    realm.users = realm.users.filter((u) => u.username !== 'customer7');
    client.fake = createFakeKeycloak(state);

    await seed();

    const again = client.fake.realm(CUSTOMER).users.find((u) => u.username === 'customer7');
    expect(again).toMatchObject({ enabled: true, realmRoles: ['customer'] });
    expect(again!.id).not.toBe('old-customer7');
    expect(client.fake.callsTo('users.create')).toHaveLength(1);
    expect(console.log).toHaveBeenCalledWith(
      '[seed] queuepass-customer-app: customer: 1 created, 199 already present (expected total 200)',
    );
    expect(console.log).toHaveBeenCalledWith(
      '[seed] queuepass-customer-app: made missing accounts, each with a new id: customer7',
    );
  });
});
