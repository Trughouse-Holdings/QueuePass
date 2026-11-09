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

/** Research R16: a venue name compared as words: upper case, "&" as "AND", a leading "THE" and punctuation dropped. */
const nameWords = (name: string): string =>
  name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^0-9A-Z]+/g, ' ')
    .trim()
    .replace(/^THE /, '');

/**
 * Research R16: map results that name a road, a town, or an area, never a building or venue. A
 * venue named "Broadway" or after its city is not confirmed by the road or the city.
 */
const NOT_A_VENUE: ReadonlySet<string> = new Set(['highway', 'place', 'boundary']);

/**
 * Research R16: a place the map found at the typed street confirms the address when it is in the
 * typed state and ZIP code and has the typed house number.
 */
export function placeAtAddress(typed: AddressParts, place: MapPlace): boolean {
  const number = houseNumber(typed.street);
  return (
    inTypedArea(typed, place) &&
    number !== '' &&
    place.houseNumber !== null &&
    sameHouseNumber(number, houseNumber(place.houseNumber))
  );
}

/**
 * Research R16: a place the map found by the venue's name confirms the address when it is that
 * venue (the same name, and not a road, town, or area), in the typed state and ZIP code, and has
 * the typed house number or none on the map (KFC Yum! Center: number 1 in 40202; Kroger Field:
 * no number, 40506). The name alone never vouches for another house number.
 */
export function placeByName(typed: AddressParts, venueName: string, place: MapPlace): boolean {
  const name = nameWords(venueName);
  if (name === '' || place.name === null || nameWords(place.name) !== name) return false;
  if (place.kind !== null && NOT_A_VENUE.has(place.kind)) return false;
  if (!inTypedArea(typed, place)) return false;
  if (place.houseNumber === null) return true;
  const number = houseNumber(typed.street);
  return number !== '' && sameHouseNumber(number, houseNumber(place.houseNumber));
}

const inTypedArea = (typed: AddressParts, place: MapPlace): boolean =>
  place.state === typed.state && place.zip === typed.zip.slice(0, 5);
