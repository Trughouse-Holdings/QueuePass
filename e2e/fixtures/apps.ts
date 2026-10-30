// Spec 022 (research R5, R8; data-model.md): the three apps, the API, and the seed's test accounts.
import type { TestInfo } from '@playwright/test';

export const APPS = {
  admin: { url: 'http://localhost:5173', name: 'QueuePass Admin', role: 'admin' },
  customer: { url: 'http://localhost:5174', name: 'QueuePass Tickets', role: 'customer' },
  booth: { url: 'http://localhost:5175', name: 'QueuePass Ticket Booth', role: 'gate agent' },
} as const;

export type AppName = keyof typeof APPS;

export const API_BASE = 'http://localhost:3000';
export const KEYCLOAK = 'http://localhost:8080';

/** The seed's password for every test account (FR-004). */
export const PASSWORD = 'test123';

/** R8: at most 3 workers, so the account ranges below never overlap. */
function slot(testInfo: TestInfo): number {
  const p = testInfo.parallelIndex;
  if (p > 2) throw new Error(`parallelIndex ${p}: the account ranges allow at most 3 workers (R8)`);
  return p;
}

/** `admin2`–`admin4`: one per worker; `admin1` and `admin5` are left for people. */
export const adminFor = (testInfo: TestInfo): string => `admin${2 + slot(testInfo)}`;

/** `agent10`–`agent24`: five per worker (`n` 0–4). */
export function agentFor(testInfo: TestInfo, n = 0): string {
  if (n < 0 || n > 4) throw new Error(`agent n ${n}: 0 to 4 (R8)`);
  return `agent${10 + slot(testInfo) * 5 + n}`;
}

/** `customer100`–`customer159`: twenty per worker (`n` 0–19). */
export function customerFor(testInfo: TestInfo, n = 0): string {
  if (n < 0 || n > 19) throw new Error(`customer n ${n}: 0 to 19 (R8)`);
  return `customer${100 + slot(testInfo) * 20 + n}`;
}
