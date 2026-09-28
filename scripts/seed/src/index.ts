import { createKeycloakClient, waitForKeycloak, loadConfig } from './keycloak-client';
import { provisionRealm } from './provision-realm';
import { provisionUsers, EXPECTED_COUNTS } from './provision-users';
import { provisionClients, FRONTEND_CLIENTS } from './provision-clients';

/**
 * Idempotent Keycloak seed (spec 001 FR-004 through FR-007).
 * Safe to run any number of times: it converges on the same 235 accounts and 3 clients.
 */
export async function seed(): Promise<void> {
  const cfg = loadConfig();
  console.log(`[seed] target ${cfg.url}, realm '${cfg.realm}'`);

  await waitForKeycloak();
  const kc = await createKeycloakClient();

  await provisionRealm(kc);
  await provisionUsers(kc);
  await provisionClients(kc);

  console.log(
    `[seed] done — ${EXPECTED_COUNTS.total} principals ` +
      `(${EXPECTED_COUNTS.admin} admins, ${EXPECTED_COUNTS.agent} gate agents, ` +
      `${EXPECTED_COUNTS.customer} customers) and ${FRONTEND_CLIENTS.length} clients`,
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
