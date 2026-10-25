import type { TimeZoneSource, UsTimeZone } from './time-zone.js';

/**
 * The 50 US states and the District of Columbia, by two-letter postal code (spec 013 FR-001).
 * Mirrors `UsState` in contracts/openapi.yaml; a Backend test keeps the two equal. The Admin app
 * shows the names in its state list ("Kentucky (KY)").
 */
export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
] as const;

export type UsState = (typeof US_STATES)[number]['code'];

/** 5 digits, or ZIP+4 (spec 013 FR-001). Only the first 5 digits are ever stored. */
export const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

/** Mirrors the Location schemas in contracts/openapi.yaml. */
export interface Location {
  id: string;
  name: string;
  /** The one-line address; when the parts are set, `formatAddress(parts)` (spec 013 FR-010). */
  address: string;
  /**
   * Spec 013: `null` for a venue from before the feature that was not re-addressed since.
   * The Backend always sends these five fields. They are optional here only because the
   * contract leaves them out of `required` until its follow-up tightening (research R11);
   * both become required together with the contract.
   */
  street?: string | null;
  city?: string | null;
  state?: UsState | null;
  zip?: string | null;
  /** Spec 013 FR-020: the address service matched this address. */
  addressVerified?: boolean;
  /**
   * Spec 020 FR-001, FR-007: the venue's time zone and how it was set. Always sent; optional here
   * only until the contract's follow-up makes them required (research R18). A client treats a
   * missing zone as `DEFAULT_TIME_ZONE`.
   */
  timeZone?: UsTimeZone;
  timeZoneSource?: TimeZoneSource;
  seatingCapacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocationInput {
  name: string;
  street: string;
  city: string;
  state: UsState;
  zip: string;
  /** Spec 013 FR-019 "save anyway", sent only after a not-found or ambiguous refusal. */
  acceptUnverifiedAddress?: boolean;
  /** Spec 020 FR-004 (research R4): an admin's explicit choice, sent only when picked. */
  timeZone?: UsTimeZone;
  seatingCapacity: number;
}

export type LocationUpdate = Partial<LocationInput>;

export const LOCATION_LIMITS = {
  nameMaxLength: 200,
  addressMaxLength: 500,
  streetMaxLength: 200,
  cityMaxLength: 100,
} as const;

/** The four address fields of a venue (spec 013). */
export interface AddressParts {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** The one format of a venue's one-line address: `STREET, CITY, ST ZIP` (spec 013 FR-010). */
export function formatAddress({ street, city, state, zip }: AddressParts): string {
  return `${street}, ${city}, ${state} ${zip}`;
}

/** A Google Maps search for the address; needs no key (spec 013 FR-014, research R10). */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
