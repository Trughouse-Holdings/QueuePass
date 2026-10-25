import type { AddressParts } from '@queuepass/shared';

export type { AddressParts };

/** Injection token for the address service client (spec 013 research R1). */
export const ADDRESS_GEOCODER = Symbol('ADDRESS_GEOCODER');

/**
 * Spec 020 research R1: where the address service placed a match. Used once, to find the venue's
 * time zone; never stored or logged.
 */
export interface Place {
  latitude: number;
  longitude: number;
}

/**
 * The address service's answer for one address (spec 013 research R1, R2):
 * exactly one match (in the service's standard form), no match, or several. A match carries its
 * place, or null when the service gave none usable (spec 020 research R1).
 */
export type GeocodeResult =
  | ({ kind: 'match'; location: Place | null } & AddressParts)
  | { kind: 'none' }
  | { kind: 'many'; candidates: string[] };

/**
 * Checks a US address. `zip` is sent as its first 5 digits. Every failure to get an answer
 * (no connection, timeout, an error status, an unreadable body) throws
 * `AddressServiceUnavailableError` (research R6).
 */
export interface AddressGeocoder {
  lookup(parts: AddressParts): Promise<GeocodeResult>;
}

/** The address service could not be asked; the cause is for the log only (research R6). */
export class AddressServiceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AddressServiceUnavailableError';
  }
}
