import type { Place } from './address-geocoder';

/** Injection token for the second address check, the map search (spec 013 research R16). */
export const MAP_SEARCH = Symbol('MAP_SEARCH');

/**
 * Research R16: one place a map search found, read from the map's own fields. Any field the map
 * does not have is null; `state` is a two-letter code and `zip` its first 5 digits.
 */
export interface MapPlace {
  name: string | null;
  houseNumber: string | null;
  state: string | null;
  zip: string | null;
  location: Place;
}

/**
 * Research R16: asked only after the address service (R1) answered with no match it vouches
 * for. Both searches are limited to the US. Every failure to get an answer throws
 * `AddressServiceUnavailableError`, as the address service does (R6).
 */
export interface MapSearch {
  /** Places the map knows at this street, city, and state. */
  byAddress(parts: { street: string; city: string; state: string }): Promise<MapPlace[]>;
  /** Places the map knows by this name in this city and state. */
  byName(name: string, where: { city: string; state: string }): Promise<MapPlace[]>;
}

/** Research R16: `ADDRESS_MAP_URL=off`. The map is never asked; every search finds nothing. */
export class NoMapSearch implements MapSearch {
  byAddress(): Promise<MapPlace[]> {
    return Promise.resolve([]);
  }
  byName(): Promise<MapPlace[]> {
    return Promise.resolve([]);
  }
}
