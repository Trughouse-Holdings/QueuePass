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
] as const satisfies readonly AppRealmRow[];

/** The single realm before 028; renamed by the seed to the customer realm (research R6). */
export const LEGACY_REALM = 'queuepass';

/** One row of `APP_REALMS`. */
export interface AppRealmRow {
  app: 'admin' | 'customer' | 'booth';
  realm: string;
  clientId: string;
  role: Role;
  prefix: string;
  count: number;
}

export type AppRealm = (typeof APP_REALMS)[number];
