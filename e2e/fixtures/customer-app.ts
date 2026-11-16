// Spec 040 (research R13, FR-017): the Customer app a journey drives. The React Customer app by
// default; the Rust Customer app in the `customer-rust` project, which runs only the journeys
// tagged `@customer`. So one set of journeys is the parity check of the two Customer apps. The
// fixture gives the app's key in `APPS`, which the sign-in helpers take; `APPS[customerApp]` is
// its address and name. It extends the Admin app fixture, so a journey that uses both apps has
// both options (`adminApp` in the `admin-rust` project, `customerApp` in `customer-rust`).
import { test as adminTest } from './admin-app';
import type { AppName } from './apps';

export type CustomerAppName = Extract<AppName, 'customer' | 'customer-rust'>;

export interface CustomerAppOptions {
  customerApp: CustomerAppName;
}

export const test = adminTest.extend<CustomerAppOptions>({
  customerApp: ['customer', { option: true }],
});

export { expect } from '@playwright/test';
