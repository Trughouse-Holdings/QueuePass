import type { AddressParts } from '../address/address-geocoder';
import type { MapPlace } from '../address/map-search';

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
  // Issue #36 (research R15): a number with one hyphen equals the same digits without it, so a
  // Queens number typed "10724" matches the service's "107-24". A range ("430-432") still
  // differs from one of its numbers, and "12-34" never equals "1-234" (review, M2).
  return (
    typed.zip.slice(0, 5) === match.zip &&
    sameHouseNumber(houseNumber(typed.street), houseNumber(match.street))
  );
}

/** Two house numbers from `houseNumber` are the same number (FR-021, research R15). */
function sameHouseNumber(a: string, b: string): boolean {
  const queens = (x: string, y: string): boolean =>
    /^\d+-\d+$/.test(x) && /^\d+$/.test(y) && x.replace('-', '') === y;
  return a === b || queens(a, b) || queens(b, a);
}

/**
 * A suite or unit at the end of a typed street: a designator ("Ste", "Suite", "Unit", "Fl",
 * "Room", …, or "#") and its number, which has a digit or is one letter ("Ste 2", "Unit B",
 * "#5"). "123 Unit Rd" has none: "Rd" is not a unit number.
 */
const DESIGNATOR =
  '(?:(?:APT|APARTMENT|BLDG|BUILDING|DEPT|FL|FLOOR|LOT|OFC|OFFICE|RM|ROOM|SPC|SPACE|STE|SUITE|UNIT)\\.?|#)';
const UNIT = new RegExp(`[\\s,]+(${DESIGNATOR}\\s*#?\\s*([0-9A-Z-]*\\d[0-9A-Z-]*|[A-Z]))$`, 'i');

/** Spec 013 FR-001: the longest street a venue can store. */
const STREET_MAX_LENGTH = 200;

/**
 * Issue #36 (research R15): the address service answers with the building's address and drops a
 * suite or unit ("430 W Vine St Ste 2" → "430 W VINE ST"). The unit the admin typed is put back
 * at the end of the matched street, upper case, unless the match already ends with a unit
 * designator and its number, or the street would be longer than a venue can store.
 */
export function keepUnit(typedStreet: string, matchStreet: string): string {
  const found = UNIT.exec(typedStreet.trim().replace(/\s+/g, ' '));
  if (!found) return matchStreet;
  const [, unit, id] = found;
  // A unit the service kept: a designator and this number at the end, not just the number
  // ("100 ROUTE 9" has no suite 9; review, M1).
  const kept = new RegExp(`(?<![A-Z])${DESIGNATOR}\\s*#?\\s*${id.replace(/-/g, '\\-')}$`, 'i');
  if (kept.test(matchStreet)) return matchStreet;
  const street = `${matchStreet} ${unit.toUpperCase()}`;
  return street.length > STREET_MAX_LENGTH ? matchStreet : street;
}

/** A street with a suite or unit at its end left off ("430 W Vine St Ste 2" → "430 W Vine St"). */
export function withoutUnit(street: string): string {
  const tidy = street.trim().replace(/\s+/g, ' ');
  const found = UNIT.exec(tidy);
  return found ? tidy.slice(0, found.index) : tidy;
}

/**
 * Research R16: the USPS short form of a direction or street type, so that a street typed in
 * full and the address service's standard form compare equal ("West Vine Street" = "W VINE ST").
 */
const SHORT: Readonly<Record<string, string>> = {
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
  ALLEY: 'ALY',
  AVENUE: 'AVE',
  AV: 'AVE',
  BOULEVARD: 'BLVD',
  CIRCLE: 'CIR',
  COURT: 'CT',
  CROSSING: 'XING',
  DRIVE: 'DR',
  EXPRESSWAY: 'EXPY',
  FREEWAY: 'FWY',
  HIGHWAY: 'HWY',
  LANE: 'LN',
  PARKWAY: 'PKWY',
  PLACE: 'PL',
  PLAZA: 'PLZ',
  POINT: 'PT',
  ROAD: 'RD',
  SQUARE: 'SQ',
  STREET: 'ST',
  TERRACE: 'TER',
  TRAIL: 'TRL',
};

/**
 * Research R16: the street without its house number or unit, upper case, with punctuation
 * dropped and every direction and street type in its short form ("430 West Vine Street, Ste 2"
 * → "W VINE ST").
 */
export function streetName(street: string): string {
  const words = withoutUnit(street)
    .toUpperCase()
    .replace(/[^0-9A-Z/-]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length > 0 && /^\d/.test(words[0])) words.shift();
  return words.map((w) => SHORT[w] ?? w).join(' ');
}

/**
 * Research R16 (issue #25): the address service's one match at another ZIP code is the typed
 * address when the house number and the street name are the same, in the same state, and the two
 * ZIP codes share their first 3 digits (one postal area). UofL's `2301 S 3rd St, 40292`, matched
 * at `40208`.
 */
export function sameStreetNearby(typed: AddressParts, match: AddressParts): boolean {
  const number = houseNumber(typed.street);
  const name = streetName(typed.street);
  return (
    number !== '' &&
    name !== '' &&
    typed.state === match.state &&
    typed.zip.slice(0, 3) === match.zip.slice(0, 3) &&
    sameHouseNumber(number, houseNumber(match.street)) &&
    name === streetName(match.street)
  );
}

/** Research R16: a venue name compared as words: upper case, "&" as "AND", a leading "THE" and punctuation dropped. */
const nameWords = (name: string): string =>
  name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^0-9A-Z]+/g, ' ')
    .trim()
    .replace(/^THE /, '');

/**
 * Research R16: a place on the map confirms the typed address when it is in the typed state and
 * ZIP code, and it has the typed house number, or it has no house number on the map and the
 * venue's name (KFC Yum! Center: house number 1 in 40202; Kroger Field: no number, 40506).
 */
export function placeConfirms(typed: AddressParts, venueName: string, place: MapPlace): boolean {
  if (place.state !== typed.state || place.zip !== typed.zip.slice(0, 5)) return false;
  if (place.houseNumber !== null) {
    const number = houseNumber(typed.street);
    return number !== '' && sameHouseNumber(number, houseNumber(place.houseNumber));
  }
  const name = nameWords(venueName);
  return name !== '' && place.name !== null && nameWords(place.name) === name;
}
