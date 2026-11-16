// Spec 028 (research R4): the browser tests' import-free copy of packages/shared/src/realms.ts,
// which the e2e job never builds; packages/shared/test/realms.test.ts checks the two are equal.
export const APP_REALMS = [
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
] as const;

/** The single realm before 028; renamed by the seed to the customer realm (research R6). */
export const LEGACY_REALM = 'queuepass';

export type AppRealm = (typeof APP_REALMS)[number];

/** Spec 040 (research R3): a front end with its own client in another app's realm (no realm, role,
 * or users of its own). A copy of `packages/shared/src/realms.ts`' table, checked equal by
 * `packages/shared/test/realms.test.ts`. */
export const SHARED_REALM_CLIENTS = [
  { app: 'customer-rust', realm: 'queuepass-customer-app', clientId: 'customer-rust-app' },
] as const;

export type SharedRealmClient = (typeof SHARED_REALM_CLIENTS)[number];

/** Spec 040 (research R3): the realm an app signs in through, from either table. */
export function realmOfApp(
  app: AppRealm['app'] | SharedRealmClient['app'],
): AppRealm['realm'] | undefined {
  return (
    APP_REALMS.find((r) => r.app === app)?.realm ??
    SHARED_REALM_CLIENTS.find((r) => r.app === app)?.realm
  );
}
