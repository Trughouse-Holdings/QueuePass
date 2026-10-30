import type KcAdminClient from '@keycloak/keycloak-admin-client';
import { loadConfig } from './keycloak-client';

export const REALM_ROLES = ['queuepass-admin', 'gate-agent', 'customer'] as const;
export type RealmRole = (typeof REALM_ROLES)[number];

/** The realm's login theme: keycloak/themes/queuepass, built into the Keycloak image (spec 021). */
export const LOGIN_THEME = 'queuepass';

/**
 * Creates the QueuePass realm and its roles only when absent (FR-005, FR-006), and converges the
 * realm's login theme on every run (spec 021 research R7, FR-010).
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
      loginTheme: LOGIN_THEME,
    });
    console.log(`[seed] created realm '${cfg.realm}'`);
    console.log(`[seed] set login theme '${LOGIN_THEME}'`);
  } else {
    console.log(`[seed] realm '${cfg.realm}' already present — leaving its other settings as is`);
    // Spec 021 R7: a realm made before the sign-in look gets it on its next run; only the login
    // theme is written, so nothing else on the realm changes.
    const current = await kc.realms.findOne({ realm: cfg.realm });
    if (current?.loginTheme === LOGIN_THEME) {
      console.log(`[seed] login theme already '${LOGIN_THEME}'`);
    } else {
      await kc.realms.update({ realm: cfg.realm }, { loginTheme: LOGIN_THEME });
      console.log(`[seed] set login theme '${LOGIN_THEME}'`);
    }
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
