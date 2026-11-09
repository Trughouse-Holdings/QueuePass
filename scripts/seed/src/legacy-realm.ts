import type KcAdminClient from '@keycloak/keycloak-admin-client';
import { APP_REALMS, LEGACY_REALM } from './app-realms';

const customer = APP_REALMS.find((r) => r.app === 'customer')!;
/** The realm the old shared realm becomes (spec 028 FR-006). */
export const CUSTOMER_REALM = customer.realm;
/** The other two apps' clients, disabled in the customer realm after the rename (FR-007). */
export const OTHER_CLIENTS = APP_REALMS.filter((r) => r !== customer).map((r) => r.clientId);

/** How many users or role members one admin request lists. */
const PAGE = 100;

/**
 * Spec 028 FR-006, FR-009 (research R5, R6): on a system made before 028, renames the old shared
 * realm `queuepass` to the Customer app's realm, so every customer keeps its subject, and with it
 * every order, ticket, hold and attempt limit. One atomic call: a run stopped before it changed
 * nothing; one stopped after it is finished by the next run.
 *
 * Nothing to do when there is no old realm. When the old realm AND the customer realm both exist
 * (code from before 028 recreated `queuepass` on an upgraded Keycloak, research R13), the seed
 * stops before changing anything, and says how to recover: nothing is merged, overwritten or
 * deleted.
 */
export async function renameLegacyRealm(kc: KcAdminClient): Promise<boolean> {
  const names = new Set((await kc.realms.find()).map((r) => r.realm));
  if (!names.has(LEGACY_REALM)) return false;
  if (names.has(CUSTOMER_REALM)) {
    throw new Error(
      `Both realm '${LEGACY_REALM}' and realm '${CUSTOMER_REALM}' exist, so the old realm ` +
        `cannot be renamed; nothing was changed. '${LEGACY_REALM}' was most likely recreated by ` +
        `code from before spec 028. To recover, rename the extra '${LEGACY_REALM}' aside in ` +
        `Keycloak's admin console (Realm settings, for example to '${LEGACY_REALM}-recreated'); ` +
        'never delete it. Then run the seed again.',
    );
  }
  await kc.realms.update({ realm: LEGACY_REALM }, { realm: CUSTOMER_REALM });
  console.log(
    `[seed] renamed realm '${LEGACY_REALM}' to '${CUSTOMER_REALM}': its users keep their ids`,
  );
  return true;
}

/**
 * Spec 028 FR-007 (research R6 step 3): in the customer realm only, disables (never deletes) every
 * enabled user without the `customer` role, the old copies of the admins and gate agents, and the
 * other two apps' clients. Changes nothing already disabled, so a second run changes nothing.
 */
export async function disableOldCopies(kc: KcAdminClient): Promise<void> {
  const realm = CUSTOMER_REALM;

  const customers = new Set<string>();
  for (let first = 0; ; first += PAGE) {
    const batch = await kc.roles.findUsersWithRole({
      realm,
      name: customer.role,
      first,
      max: PAGE,
    });
    for (const u of batch) customers.add(u.id as string);
    if (batch.length < PAGE) break;
  }

  const disabled: string[] = [];
  for (let first = 0; ; first += PAGE) {
    const batch = await kc.users.find({ realm, first, max: PAGE });
    for (const u of batch) {
      if (u.enabled === false || customers.has(u.id as string)) continue;
      const full = await kc.users.findOne({ realm, id: u.id as string });
      await kc.users.update({ realm, id: u.id as string }, { ...full, enabled: false });
      disabled.push(u.username as string);
    }
    if (batch.length < PAGE) break;
  }
  console.log(
    disabled.length > 0
      ? `[seed] ${realm}: disabled ${disabled.length} old accounts without the '${customer.role}' role: ${disabled.join(', ')}`
      : `[seed] ${realm}: no enabled account without the '${customer.role}' role`,
  );

  for (const clientId of OTHER_CLIENTS) {
    const [client] = await kc.clients.find({ realm, clientId });
    if (!client?.id) continue;
    if (client.enabled === false) {
      console.log(`[seed] ${realm}: client '${clientId}' already disabled`);
      continue;
    }
    await kc.clients.update({ realm, id: client.id }, { ...client, enabled: false });
    console.log(`[seed] ${realm}: disabled client '${clientId}'`);
  }
}
