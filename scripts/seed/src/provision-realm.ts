import type KcAdminClient from '@keycloak/keycloak-admin-client';
import type { AppRealm } from './app-realms';

/** The login theme of every app realm: keycloak/themes/queuepass, built into the Keycloak image (spec 021). */
export const LOGIN_THEME = 'queuepass';

/**
 * Creates one app realm and its one role only when absent (spec 001 FR-005, FR-006; spec 028
 * FR-005), and converges the realm's login theme on every run (spec 021 research R7, FR-010;
 * spec 028 FR-008).
 *
 * Check-then-create rather than realm import: realm import applies ONLY when the realm
 * does not already exist, so on a second startup against a persisted Keycloak database it
 * silently does nothing. That is a no-op, not idempotence, and it cannot repair drift.
 * See spec 001 research R5.
 */
export async function provisionRealm(
  kc: KcAdminClient,
  realm: string,
  role: AppRealm['role'],
): Promise<void> {
  const realms = await kc.realms.find();
  const exists = realms.some((r) => r.realm === realm);

  if (!exists) {
    await kc.realms.create({
      realm,
      enabled: true,
      displayName: 'QueuePass',
      registrationAllowed: false,
      loginWithEmailAllowed: true,
      loginTheme: LOGIN_THEME,
    });
    console.log(`[seed] created realm '${realm}'`);
    console.log(`[seed] ${realm}: set login theme '${LOGIN_THEME}'`);
  } else {
    console.log(`[seed] realm '${realm}' already present — leaving its other settings as is`);
    // Spec 021 R7: a realm made before the sign-in look gets it on its next run; only the login
    // theme is written, so nothing else on the realm changes.
    const current = await kc.realms.findOne({ realm });
    if (current?.loginTheme === LOGIN_THEME) {
      console.log(`[seed] ${realm}: login theme already '${LOGIN_THEME}'`);
    } else {
      await kc.realms.update({ realm }, { loginTheme: LOGIN_THEME });
      console.log(`[seed] ${realm}: set login theme '${LOGIN_THEME}'`);
    }
  }

  const existingRoles = await kc.roles.find({ realm });
  if (existingRoles.some((r) => r.name === role)) {
    console.log(`[seed] ${realm}: role '${role}' already present`);
    return;
  }
  await kc.roles.create({ realm, name: role });
  console.log(`[seed] ${realm}: created role '${role}'`);
}
