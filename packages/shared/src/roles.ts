/**
 * The Keycloak realm roles QueuePass recognizes (Constitution V). Any other role in a token's
 * `realm_access.roles` (such as `offline_access`) is ignored.
 */
export const QUEUEPASS_ROLES = ['queuepass-admin', 'gate-agent', 'customer'] as const;

export type Role = (typeof QUEUEPASS_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (QUEUEPASS_ROLES as readonly string[]).includes(value);
}
