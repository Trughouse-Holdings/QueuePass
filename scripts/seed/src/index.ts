import { APP_REALMS, SHARED_REALM_CLIENTS } from './app-realms';
import { createKeycloakClient, waitForKeycloak, loadConfig } from './keycloak-client';
import { disableOldCopies, renameLegacyRealm } from './legacy-realm';
import { provisionRealm } from './provision-realm';
import { provisionUsers, EXPECTED_COUNTS } from './provision-users';
import { provisionClient, FRONTEND_CLIENTS } from './provision-clients';

/**
 * Idempotent Keycloak seed (spec 001 FR-004 through FR-007; spec 028 FR-005 to FR-009).
 * Safe to run any number of times: it converges on the same four app realms, each with its own
 * app's client and its users, 240 in all, and (spec 040, research R3) on each
 * `SHARED_REALM_CLIENTS` row's client in its realm, with no realm or users of its own: five
 * clients. On a system made before spec 028, it first renames the old shared realm to the Customer
 * app's realm, and last disables the old admin and agent copies and the other apps' clients there
 * (research R6), never a shared-realm client.
 */
export async function seed(): Promise<void> {
  const cfg = loadConfig();
  console.log(
    `[seed] target ${cfg.url}, realms ${APP_REALMS.map((r) => `'${r.realm}'`).join(', ')}`,
  );

  await waitForKeycloak();
  const kc = await createKeycloakClient();

  await renameLegacyRealm(kc);
  for (const app of APP_REALMS) {
    await provisionRealm(kc, app.realm, app.role);
    await provisionClient(
      kc,
      app.realm,
      FRONTEND_CLIENTS.find((c) => c.clientId === app.clientId)!,
    );
    await provisionUsers(kc, app);
  }
  for (const row of SHARED_REALM_CLIENTS) {
    await provisionClient(
      kc,
      row.realm,
      FRONTEND_CLIENTS.find((c) => c.clientId === row.clientId)!,
    );
  }
  await disableOldCopies(kc);

  console.log(
    `[seed] done — ${APP_REALMS.map((r) => `${r.realm}: ${r.count} ${r.prefix}`).join(', ')} ` +
      `(${EXPECTED_COUNTS.total} principals, ${FRONTEND_CLIENTS.length} clients)`,
  );
}

const isEntrypoint =
  process.argv[1] !== undefined && /scripts[/\\]seed[/\\]src[/\\]index\.ts$/.test(process.argv[1]);

if (isEntrypoint) {
  seed().catch((err: unknown) => {
    console.error('[seed] FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
