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
] as const;

/** The single realm before 028; renamed by the seed to the customer realm (research R6). */
export const LEGACY_REALM = 'queuepass';

export type AppRealm = (typeof APP_REALMS)[number];
