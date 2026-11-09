import { describe, it, expect } from 'vitest';
import { APP_REALMS, LEGACY_REALM } from '../src/realms';
import { isRole, QUEUEPASS_ROLES } from '../src/roles';
import * as shared from '../src/index';
// Research R4: the seed and the e2e tests build no `packages/shared`, so each keeps an
// import-free copy of the table; this test fails when either drifts from the source.
import * as seedCopy from '../../../scripts/seed/src/app-realms';
import * as e2eCopy from '../../../e2e/fixtures/realms';

/** Spec 028 data-model.md: one realm per app, each with its client, its one role and its users. */
describe('APP_REALMS', () => {
  it('has exactly the three rows of the data model', () => {
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
    ]);
  });

  it('names each realm once, and never as a role or the old shared realm', () => {
    const realms = APP_REALMS.map((r) => r.realm);
    expect(new Set(realms).size).toBe(3);
    for (const realm of realms) {
      expect(QUEUEPASS_ROLES as readonly string[]).not.toContain(realm);
      expect(realm).not.toBe(LEGACY_REALM);
    }
  });

  it('gives each realm one QueuePass role, each role in exactly one realm', () => {
    for (const { role } of APP_REALMS) expect(isRole(role)).toBe(true);
    expect(APP_REALMS.map((r) => r.role).sort()).toEqual([...QUEUEPASS_ROLES].sort());
  });

  it('holds the 235 seeded accounts between them', () => {
    expect(APP_REALMS.reduce((sum, r) => sum + r.count, 0)).toBe(235);
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
