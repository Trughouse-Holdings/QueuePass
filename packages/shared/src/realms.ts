import type { Role } from './roles.js';

/**
 * Spec 028 (data-model.md, research R4): one Keycloak realm per app, so each app has its own
 * sign-in in the browser. Each realm holds its app's one client, its one role, and the users of
 * that role. The source of the table: the seed (`scripts/seed/src/app-realms.ts`) and the browser
 * tests (`e2e/fixtures/realms.ts`), which build no `packages/shared`, keep import-free copies that
 * `test/realms.test.ts` checks are equal to this one.
 */
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
] as const satisfies readonly AppRealmRow[];

/** The single realm before 028; renamed by the seed to the customer realm (research R6). */
export const LEGACY_REALM = 'queuepass';

/** One row of `APP_REALMS`. */
export interface AppRealmRow {
  app: 'admin' | 'customer' | 'booth' | 'admin-rust';
  realm: string;
  clientId: string;
  role: Role;
  prefix: string;
  count: number;
}

export type AppRealm = (typeof APP_REALMS)[number];

/** One row of `SHARED_REALM_CLIENTS`. */
export interface SharedRealmClientRow {
  app: 'customer-rust';
  realm: AppRealm['realm'];
  clientId: string;
}

/** Spec 040 (research R3): a front end with its own client in another app's realm. It has no
 * realm, role, or users of its own: it uses that realm's, so the seed makes no extra account. */
export const SHARED_REALM_CLIENTS = [
  { app: 'customer-rust', realm: 'queuepass-customer-app', clientId: 'customer-rust-app' },
] as const satisfies readonly SharedRealmClientRow[];

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
