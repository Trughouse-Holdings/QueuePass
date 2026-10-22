import type { ApiClient } from '@queuepass/shared/web';

/**
 * Spec 015 FR-008 (research R8): logging out releases every seat this customer has reserved, for
 * every event, while the token is still in memory. The shared AuthProvider waits for it at most 2
 * seconds and signs out even if it fails; the reservations then end with their 5 minutes.
 */
export async function releaseOnLogout(api: ApiClient): Promise<void> {
  await api.POST('/me/reservations/release');
}
