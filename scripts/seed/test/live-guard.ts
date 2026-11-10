import { LEGACY_REALM } from '../src/app-realms';

/**
 * Spec 028 research R13 (tasks T015a): the guard of the live seed tests, which reach whatever
 * Keycloak answers on localhost. `seed-idempotence` runs `seed()`, which would rename a stack's
 * realm `queuepass`; `sign-in-screens` fetches the app realms' pages, which a Keycloak not yet
 * upgraded does not have. So both skip, with this reason, when the Keycloak they reach still has
 * realm `queuepass`, unless `QP_SEED_ALLOW_RENAME=1` (only ever on a throwaway stack).
 */
export const RENAME_SKIP_REASON =
  'this Keycloak still has the shared realm; set QP_SEED_ALLOW_RENAME=1 to let the tests rename it';

const KEYCLOAK = (): string => process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
// Keycloak 26 serves /health/* on the management port (9000), not 8080.
const HEALTH = (): string => process.env.KEYCLOAK_HEALTH_URL ?? 'http://localhost:9000';

async function keycloakUp(): Promise<boolean> {
  try {
    return (await fetch(`${HEALTH()}/health/ready`)).ok;
  } catch {
    return false;
  }
}

/** Whether realm `queuepass` exists: its public realm page answers 200, an absent realm 404. */
async function legacyRealmExists(): Promise<boolean> {
  try {
    const res = await fetch(`${KEYCLOAK()}/realms/${LEGACY_REALM}`);
    return res.status !== 404;
  } catch {
    // Unsure: count it as present, so nothing is renamed by mistake.
    return true;
  }
}

/**
 * Why the live tests must skip, or undefined when they may run: `unreachable` when no Keycloak
 * answers, `RENAME_SKIP_REASON` when it still has realm `queuepass` and the switch is not set.
 */
export async function liveSkipReason(unreachable: string): Promise<string | undefined> {
  if (!(await keycloakUp())) return unreachable;
  if (process.env.QP_SEED_ALLOW_RENAME === '1') return undefined;
  return (await legacyRealmExists()) ? RENAME_SKIP_REASON : undefined;
}
