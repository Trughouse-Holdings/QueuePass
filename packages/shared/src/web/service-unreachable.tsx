/**
 * Spec 001 FR-017: never a blank or partial page when the Backend is down. Spec 012 FR-010: shown
 * as the shared theme's error banner (the Booth app loads no theme, so it stays plain there).
 */
export function ServiceUnreachable() {
  return (
    <p role="alert" className="banner banner--error">
      Can&apos;t reach the QueuePass service.
    </p>
  );
}
