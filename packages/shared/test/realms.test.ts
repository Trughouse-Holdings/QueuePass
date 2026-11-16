import { describe, it, expect } from 'vitest';
import { APP_REALMS, LEGACY_REALM, SHARED_REALM_CLIENTS, realmOfApp } from '../src/realms';
import { isRole, QUEUEPASS_ROLES } from '../src/roles';
import * as shared from '../src/index';
// Research R4: the seed and the e2e tests build no `packages/shared`, so each keeps an
// import-free copy of the table; this test fails when either drifts from the source.
import * as seedCopy from '../../../scripts/seed/src/app-realms';
import * as e2eCopy from '../../../e2e/fixtures/realms';

/** Spec 028 data-model.md: one realm per app, each with its client, its one role and its users.
 * Spec 037 (research R4): a fourth row, the Rust Admin app, shares the admin role. */
describe('APP_REALMS', () => {
  it('has exactly the four rows of the data model', () => {
    expect(APP_REALMS).toEqual([
      {
        app: 'admin',
        realm: 'queuepass-admin-app',
        clientId: 'admin-app',
        role: 'queuepass-admin',
        prefix: 'admin',
        count: 5,
      },
      {
        app: 'customer',
        realm: 'queuepass-customer-app',
        clientId: 'customer-app',
        role: 'customer',
        prefix: 'customer',
        count: 200,
      },
      {
        app: 'booth',
        realm: 'queuepass-booth-app',
        clientId: 'booth-app',
        role: 'gate-agent',
        prefix: 'agent',
        count: 30,
      },
      {
        app: 'admin-rust',
        realm: 'queuepass-admin-rust-app',
        clientId: 'admin-rust-app',
        role: 'queuepass-admin',
        prefix: 'admin',
        count: 5,
      },
    ]);
  });

  it('names each realm and each client once, and never as a role or the old shared realm', () => {
    const realms = APP_REALMS.map((r) => r.realm);
    expect(realms).toHaveLength(4);
    expect(new Set(realms).size).toBe(4);
    expect(new Set(APP_REALMS.map((r) => r.clientId)).size).toBe(4);
    for (const realm of realms) {
      expect(QUEUEPASS_ROLES as readonly string[]).not.toContain(realm);
      expect(realm).not.toBe(LEGACY_REALM);
    }
  });

  it('gives each realm one QueuePass role, and every role has a realm (037: two share the admin role)', () => {
    for (const { role } of APP_REALMS) expect(isRole(role)).toBe(true);
    for (const role of QUEUEPASS_ROLES) {
      expect(APP_REALMS.map((r) => r.role)).toContain(role);
    }
  });

  it('holds the 240 seeded accounts between them', () => {
    expect(APP_REALMS.reduce((sum, r) => sum + r.count, 0)).toBe(240);
  });

  it('names the old shared realm `queuepass`', () => {
    expect(LEGACY_REALM).toBe('queuepass');
  });

  it('is exported from the package', () => {
    expect(shared.APP_REALMS).toBe(APP_REALMS);
    expect(shared.LEGACY_REALM).toBe(LEGACY_REALM);
  });

  it("matches the seed's import-free copy", () => {
    expect(seedCopy.APP_REALMS).toEqual(APP_REALMS);
    expect(seedCopy.LEGACY_REALM).toBe(LEGACY_REALM);
  });

  it("matches the browser tests' import-free copy", () => {
    expect(e2eCopy.APP_REALMS).toEqual(APP_REALMS);
    expect(e2eCopy.LEGACY_REALM).toBe(LEGACY_REALM);
  });
});

/** Spec 040 (research R3): a front end with its own client in another app's realm. */
describe('SHARED_REALM_CLIENTS', () => {
  it('has exactly the Rust Customer app, a client in the Customer realm', () => {
    expect(SHARED_REALM_CLIENTS).toEqual([
      { app: 'customer-rust', realm: 'queuepass-customer-app', clientId: 'customer-rust-app' },
    ]);
  });

  it("puts each row in one of APP_REALMS' realms", () => {
    const realms = APP_REALMS.map((r) => r.realm) as readonly string[];
    for (const row of SHARED_REALM_CLIENTS) expect(realms).toContain(row.realm);
  });

  it('names each client once across both tables, and each app once', () => {
    const clientIds = [...APP_REALMS, ...SHARED_REALM_CLIENTS].map((r) => r.clientId);
    expect(new Set(clientIds).size).toBe(clientIds.length);
    const apps = [...APP_REALMS, ...SHARED_REALM_CLIENTS].map((r) => r.app);
    expect(new Set(apps).size).toBe(apps.length);
  });

  it('adds no account: APP_REALMS still holds the 240', () => {
    expect(APP_REALMS).toHaveLength(4);
    expect(APP_REALMS.reduce((sum, r) => sum + r.count, 0)).toBe(240);
  });

  it('realmOfApp finds an app in either table', () => {
    expect(realmOfApp('admin')).toBe('queuepass-admin-app');
    expect(realmOfApp('customer')).toBe('queuepass-customer-app');
    expect(realmOfApp('booth')).toBe('queuepass-booth-app');
    expect(realmOfApp('admin-rust')).toBe('queuepass-admin-rust-app');
    expect(realmOfApp('customer-rust')).toBe('queuepass-customer-app');
  });

  it('is exported from the package', () => {
    expect(shared.SHARED_REALM_CLIENTS).toBe(SHARED_REALM_CLIENTS);
    expect(shared.realmOfApp).toBe(realmOfApp);
  });

  it("matches the seed's and the browser tests' import-free copies", () => {
    expect(seedCopy.SHARED_REALM_CLIENTS).toEqual(SHARED_REALM_CLIENTS);
    expect(e2eCopy.SHARED_REALM_CLIENTS).toEqual(SHARED_REALM_CLIENTS);
  });
});
