import { Module } from '@nestjs/common';
import { ADDRESS_GEOCODER } from './address-geocoder';
import { CensusGeocoder } from './census-geocoder';
import { MAP_SEARCH, NoMapSearch } from './map-search';
import { NominatimSearch } from './nominatim-search';
import { GeoTzFinder, TIME_ZONE_FINDER } from './time-zone-finder';

/**
 * The address service (spec 013 research R1, R12). `ADDRESS_GEOCODER_URL` is not a secret; the
 * Census Geocoder needs no key. Unset or empty, it defaults to the Census service. Tests
 * replace `ADDRESS_GEOCODER` with a fake (research R9).
 *
 * Research R16: the map search, asked when the Census service vouches for no match.
 * `ADDRESS_MAP_URL` is not a secret either; unset or empty, it is OpenStreetMap's public
 * Nominatim, and `off` turns the map search off. Tests replace `MAP_SEARCH` with a fake.
 *
 * Spec 020 research R1: the zone at a matched place, looked up offline. Tests keep the real
 * finder; the fake geocoder sets the places.
 */
@Module({
  providers: [
    {
      provide: ADDRESS_GEOCODER,
      useFactory: () =>
        new CensusGeocoder({
          baseUrl: process.env.ADDRESS_GEOCODER_URL || 'https://geocoding.geo.census.gov',
        }),
    },
    {
      provide: MAP_SEARCH,
      useFactory: () => {
        const url = process.env.ADDRESS_MAP_URL?.trim();
        if (url?.toLowerCase() === 'off') return new NoMapSearch();
        return new NominatimSearch({ baseUrl: url || 'https://nominatim.openstreetmap.org' });
      },
    },
    { provide: TIME_ZONE_FINDER, useClass: GeoTzFinder },
  ],
  exports: [ADDRESS_GEOCODER, MAP_SEARCH, TIME_ZONE_FINDER],
})
export class AddressModule {}
