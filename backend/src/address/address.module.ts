import { Module } from '@nestjs/common';
import { ADDRESS_GEOCODER } from './address-geocoder';
import { CensusGeocoder } from './census-geocoder';

/**
 * The address service (spec 013 research R1, R12). `ADDRESS_GEOCODER_URL` is not a secret; the
 * Census Geocoder needs no key. Unset or empty, it defaults to the Census service. Tests replace `ADDRESS_GEOCODER` with a fake (research R9).
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
  ],
  exports: [ADDRESS_GEOCODER],
})
export class AddressModule {}
