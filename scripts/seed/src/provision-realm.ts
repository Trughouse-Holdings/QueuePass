import type KcAdminClient from '@keycloak/keycloak-admin-client';
import { loadConfig } from './keycloak-client';

export const REALM_ROLES = ['queuepass-admin', 'gate-agent', 'customer'] as const;
export type RealmRole = (typeof REALM_ROLES)[number];

/**
 * Creates the QueuePass realm and its roles only when absent (FR-005, FR-006).
 *
 * Check-then-create rather than realm import: realm import applies ONLY when the realm
 * does not already exist, so on a second startup against a persisted Keycloak database it
 * silently does nothing. That is a no-op, not idempotence, and it cannot repair drift.
 * See research R5.
 */
export async function provisionRealm(kc: KcAdminClient): Promise<void> {
  const cfg = loadConfig();

  const realms = await kc.realms.find();
  const exists = realms.some((r) => r.realm === cfg.realm);

  if (!exists) {
    await kc.realms.create({
      realm: cfg.realm,
      enabled: true,
      displayName: 'QueuePass',
      registrationAllowed: false,
      loginWithEmailAllowed: true,
    });
    console.log(`[seed] created realm '${cfg.realm}'`);
  } else {
    console.log(`[seed] realm '${cfg.realm}' already present — leaving as is`);
  }

  const existingRoles = await kc.roles.find({ realm: cfg.realm });
  const existingNames = new Set(existingRoles.map((r) => r.name));

  for (const role of REALM_ROLES) {
    if (existingNames.has(role)) {
      console.log(`[seed] role '${role}' already present`);
      continue;
    }
    await kc.roles.create({ realm: cfg.realm, name: role });
    console.log(`[seed] created role '${role}'`);
  }
}
