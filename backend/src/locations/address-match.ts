import type { AddressParts } from '../address/address-geocoder';

/**
 * The leading house number of a street ("1540 University Dr" → "1540"), or "" when none. Letters,
 * "/" and "-" belong to it ("12B", "100-02"); trailing punctuation does not ("1540," → "1540"),
 * and leading zeros are dropped ("0430" → "430"), so the comparison is of the number itself.
 */
export function houseNumber(street: string): string {
  const token = /^\d[0-9A-Z/-]*/i.exec(street.trim())?.[0].toUpperCase() ?? '';
  return token.replace(/^0+(?=\d)/, '');
}

/**
 * Spec 013 FR-021, research R3: the address service's one match is trusted only when it keeps
 * the ZIP code (first 5 digits) and house number that were typed. The rest of the street is not
 * compared, because the service writes it in its own standard form ("West Vine Street" →
 * "W VINE ST"), and the city may be corrected.
 */
export function matchesTyped(typed: AddressParts, match: AddressParts): boolean {
  return (
    typed.zip.slice(0, 5) === match.zip && houseNumber(typed.street) === houseNumber(match.street)
  );
}
