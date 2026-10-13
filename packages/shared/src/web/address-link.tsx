import { mapsUrl } from '../location.js';

/**
 * A venue's one-line address as a link to Google Maps, in a new tab that cannot reach this page
 * (spec 013 FR-014, FR-015; research R10). Shared so the Admin and Customer apps match.
 */
export function AddressLink({ address }: { address: string }) {
  return (
    <a
      href={mapsUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${address} (opens Google Maps in a new tab)`}
    >
      {address}
    </a>
  );
}
