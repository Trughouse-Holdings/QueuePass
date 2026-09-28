/** Spec 001 FR-017: never a blank or partial page when the Backend is down. */
export function ServiceUnreachable() {
  return <p role="alert">Can&apos;t reach the QueuePass service.</p>;
}
