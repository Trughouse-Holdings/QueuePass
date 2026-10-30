/** Research R12 of spec 019: an immediate revoke can cancel the download in Safari and Firefox. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Spec 023 research R1: the browser saves the file, as spec 019's calendar file does
 * (`customer-app/src/components/AddToCalendar.tsx`); nothing is stored on the server.
 */
export function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
