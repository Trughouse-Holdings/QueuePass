// Spec 037 (research R10, FR-017): the Admin app a journey drives. The React Admin app by default;
// the Rust Admin app in the `admin-rust` project, which runs only the journeys tagged `@admin`. So
// one set of journeys is the parity check of the two apps. The fixture gives the app's key in
// `APPS`, which the sign-in helpers take; `APPS[adminApp]` is its address and name.
import { test as base } from '@playwright/test';
import type { AppName } from './apps';

export type AdminAppName = Extract<AppName, 'admin' | 'admin-rust'>;

export interface AdminAppOptions {
  adminApp: AdminAppName;
}

export const test = base.extend<AdminAppOptions>({
  adminApp: ['admin', { option: true }],
});

export { expect } from '@playwright/test';
