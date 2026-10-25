import { Module } from '@nestjs/common';
import { ADDRESS_GEOCODER } from './address-geocoder';
import { CensusGeocoder } from './census-geocoder';
import { GeoTzFinder, TIME_ZONE_FINDER } from './time-zone-finder';

/**
 * The address service (spec 013 research R1, R12). `ADDRESS_GEOCODER_URL` is not a secret; the
 * Census Geocoder needs no key. Unset or empty, it defaults to the Census service. Tests
 * replace `ADDRESS_GEOCODER` with a fake (research R9).
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
    { provide: TIME_ZONE_FINDER, useClass: GeoTzFinder },
  ],
  exports: [ADDRESS_GEOCODER, TIME_ZONE_FINDER],
})
export class AddressModule {}
