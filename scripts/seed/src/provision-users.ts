import type KcAdminClient from '@keycloak/keycloak-admin-client';
import { APP_REALMS, type AppRealm } from './app-realms';
import { loadConfig } from './keycloak-client';

/** Exactly the principals spec 001 FR-003 requires: 5 + 30 + 200 = 235, one group per realm. */
const countOf = (prefix: AppRealm['prefix']): number =>
  APP_REALMS.find((r) => r.prefix === prefix)!.count;

export const EXPECTED_COUNTS = {
  admin: countOf('admin'),
  agent: countOf('agent'),
  customer: countOf('customer'),
  total: APP_REALMS.reduce((sum, r) => sum + r.count, 0),
} as const;

/**
 * Creates one app realm's users, `prefix1`…`prefixN` (spec 028 FR-005), each enabled, with the
 * realm's role and a non-temporary password (spec 001 FR-004).
 *
 * Every user is checked for before creation, so a second run neither duplicates nor aborts
 * (FR-009); an existing user is left alone. The user set is fixed, so runs are deterministic.
 */
export async function provisionUsers(
  kc: KcAdminClient,
  { realm, role: roleName, prefix, count }: AppRealm,
): Promise<void> {
  const { userPassword } = loadConfig();
  const role = await kc.roles.findOneByName({ realm, name: roleName });
  if (!role || !role.id) {
    throw new Error(
      `Role '${roleName}' missing from realm '${realm}' — provisionRealm must run first.`,
    );
  }

  const created: string[] = [];
  let present = 0;

  for (let i = 1; i <= count; i++) {
    const username = `${prefix}${i}`;

    const found = await kc.users.find({ realm, username, exact: true });
    if (found.length > 0) {
      present++;
      continue;
    }

    const { id } = await kc.users.create({
      realm,
      username,
      enabled: true,
      emailVerified: true,
      email: `${username}@queuepass.local`,
      firstName: prefix,
      lastName: String(i),
      credentials: [
        {
          type: 'password',
          value: userPassword,
          // Non-temporary: the account must be usable immediately after startup (FR-004),
          // with no forced password change blocking sign-in.
          temporary: false,
        },
      ],
    });

    await kc.users.addRealmRoleMappings({
      realm,
      id,
      roles: [{ id: role.id, name: role.name as string }],
    });

    created.push(username);
  }

  console.log(
    `[seed] ${realm}: ${prefix}: ${created.length} created, ${present} already present ` +
      `(expected total ${count})`,
  );
  // Spec 028 T014 (c): an account missing from a realm that holds the others (deleted by hand) is
  // made again, with a new subject; say which.
  if (created.length > 0 && present > 0) {
    console.log(
      `[seed] ${realm}: made missing accounts, each with a new id: ${created.join(', ')}`,
    );
  }
}
