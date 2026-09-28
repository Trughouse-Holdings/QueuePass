import type KcAdminClient from '@keycloak/keycloak-admin-client';
import { loadConfig } from './keycloak-client';
import type { RealmRole } from './provision-realm';

export interface UserGroup {
  key: 'admin' | 'agent' | 'customer';
  prefix: string;
  count: number;
  role: RealmRole;
}

/** Exactly the principals FR-003 requires: 5 + 30 + 200 = 235. */
export const USER_GROUPS: readonly UserGroup[] = [
  { key: 'admin', prefix: 'admin', count: 5, role: 'queuepass-admin' },
  { key: 'agent', prefix: 'agent', count: 30, role: 'gate-agent' },
  { key: 'customer', prefix: 'customer', count: 200, role: 'customer' },
] as const;

export const EXPECTED_COUNTS = { admin: 5, agent: 30, customer: 200, total: 235 } as const;

/**
 * Creates admin1-admin5, agent1-agent30, customer1-customer200 (FR-003), each enabled,
 * role-assigned, with a non-temporary password (FR-004).
 *
 * Every user is checked for before creation, so a second run neither duplicates nor
 * aborts (FR-005). The user set is fixed, so runs are deterministic (FR-006).
 */
export async function provisionUsers(kc: KcAdminClient): Promise<void> {
  const cfg = loadConfig();

  for (const group of USER_GROUPS) {
    const role = await kc.roles.findOneByName({ realm: cfg.realm, name: group.role });
    if (!role || !role.id) {
      throw new Error(`Role '${group.role}' missing — provisionRealm must run first.`);
    }

    let created = 0;
    let skipped = 0;

    for (let i = 1; i <= group.count; i++) {
      const username = `${group.prefix}${i}`;

      const found = await kc.users.find({ realm: cfg.realm, username, exact: true });
      if (found.length > 0) {
        skipped++;
        continue;
      }

      const { id } = await kc.users.create({
        realm: cfg.realm,
        username,
        enabled: true,
        emailVerified: true,
        email: `${username}@queuepass.local`,
        firstName: group.prefix,
        lastName: String(i),
        credentials: [
          {
            type: 'password',
            value: cfg.userPassword,
            // Non-temporary: the account must be usable immediately after startup (FR-004),
            // with no forced password change blocking sign-in.
            temporary: false,
          },
        ],
      });

      await kc.users.addRealmRoleMappings({
        realm: cfg.realm,
        id,
        roles: [{ id: role.id, name: role.name as string }],
      });

      created++;
    }

    console.log(
      `[seed] ${group.prefix}: ${created} created, ${skipped} already present ` +
        `(expected total ${group.count})`,
    );
  }
}
