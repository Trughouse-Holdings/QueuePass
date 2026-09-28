import KcAdminClient from '@keycloak/keycloak-admin-client';

export interface SeedConfig {
  url: string;
  healthUrl: string;
  adminUser: string;
  adminPassword: string;
  realm: string;
  userPassword: string;
}

export function loadConfig(): SeedConfig {
  return {
    url: process.env.KEYCLOAK_URL ?? 'http://localhost:8080',
    // Keycloak 26 serves /health/* on the MANAGEMENT port (9000), not the HTTP port
    // (8080). Polling 8080/health/ready returns 404 forever — the seed then times out
    // after 3 minutes with a message blaming KC_HEALTH_ENABLED, which is a red herring.
    healthUrl: process.env.KEYCLOAK_HEALTH_URL ?? 'http://localhost:9000',
    adminUser: process.env.KEYCLOAK_ADMIN ?? 'admin',
    adminPassword: process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin',
    realm: process.env.KEYCLOAK_REALM ?? 'queuepass',
    // LOCAL DEVELOPMENT ONLY — see README and the constitution's security constraints.
    userPassword: process.env.SEED_USER_PASSWORD ?? 'test123',
  };
}

/** Authenticates against the master realm using the admin-cli client. */
export async function createKeycloakClient(): Promise<KcAdminClient> {
  const cfg = loadConfig();
  const client = new KcAdminClient({ baseUrl: cfg.url, realmName: 'master' });

  await client.auth({
    username: cfg.adminUser,
    password: cfg.adminPassword,
    grantType: 'password',
    clientId: 'admin-cli',
  });

  return client;
}

/**
 * Waits for Keycloak to report ready.
 *
 * Without this the seed races container startup and fails intermittently — a failure mode
 * that looks like a code bug but is pure timing, and one that directly threatens SC-001
 * and SC-002 (research R5).
 */
export async function waitForKeycloak(timeoutMs = 180_000): Promise<void> {
  const cfg = loadConfig();
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${cfg.healthUrl}/health/ready`);
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(
    `Keycloak health at ${cfg.healthUrl}/health/ready was not ready within ${timeoutMs}ms ` +
      `(last error: ${lastError}). Confirm KC_HEALTH_ENABLED=true and that the management ` +
      'port (9000) is reachable.',
  );
}
