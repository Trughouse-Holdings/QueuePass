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
  // Issue #36 (research R15): the hyphen is not compared, so a Queens number typed "10724"
  // matches the service's "107-24". A range ("430-432") still differs from one of its numbers.
  const digits = (street: string): string => houseNumber(street).replace(/-/g, '');
  return typed.zip.slice(0, 5) === match.zip && digits(typed.street) === digits(match.street);
}

/**
 * A suite or unit at the end of a typed street: a designator ("Ste", "Suite", "Unit", "Fl",
 * "Room", …, or "#") and its number, which has a digit or is one letter ("Ste 2", "Unit B",
 * "#5"). "123 Unit Rd" has none: "Rd" is not a unit number.
 */
const UNIT =
  /[\s,]+((?:(?:APT|APARTMENT|BLDG|BUILDING|DEPT|FL|FLOOR|LOT|OFC|OFFICE|RM|ROOM|SPC|SPACE|STE|SUITE|UNIT)\.?|#)\s*#?\s*([0-9A-Z-]*\d[0-9A-Z-]*|[A-Z]))$/i;

/** Spec 013 FR-001: the longest street a venue can store. */
const STREET_MAX_LENGTH = 200;

/**
 * Issue #36 (research R15): the address service answers with the building's address and drops a
 * suite or unit ("430 W Vine St Ste 2" → "430 W VINE ST"). The unit the admin typed is put back
 * at the end of the matched street, upper case, unless the match already ends with its number
 * or the street would be longer than a venue can store.
 */
export function keepUnit(typedStreet: string, matchStreet: string): string {
  const found = UNIT.exec(typedStreet.trim().replace(/\s+/g, ' '));
  if (!found) return matchStreet;
  const [, unit, id] = found;
  const kept = new RegExp(`[\\s#]${id.toUpperCase().replace(/-/g, '\\-')}$`);
  if (kept.test(matchStreet)) return matchStreet;
  const street = `${matchStreet} ${unit.toUpperCase()}`;
  return street.length > STREET_MAX_LENGTH ? matchStreet : street;
}
