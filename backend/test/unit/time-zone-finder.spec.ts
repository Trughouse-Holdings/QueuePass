import { Logger } from '@nestjs/common';
import { GeoTzFinder } from '../../src/address/time-zone-finder';

/**
 * Spec 020 research R1: the zone at a place, from geo-tz's "now" boundaries shipped in the
 * package (offline). Pins R1's table, so a geo-tz upgrade that changes an answer fails here.
 */
describe('GeoTzFinder', () => {
  const finder = new GeoTzFinder();
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it.each([
    // R1's eight Census matches, checked live on 2026-10-24.
    ['430 W Vine St, Lexington KY', 38.0494, -84.501, 'America/New_York'],
    ['937 Phillips Ln, Louisville KY', 38.1941, -85.7389, 'America/New_York'],
    ['201 E Jefferson St, Phoenix AZ', 33.4465, -112.0706, 'America/Phoenix'],
    ['1701 Bryant St, Denver CO', 39.7459, -105.019, 'America/Denver'],
    ['111 S Grand Ave, Los Angeles CA', 34.0556, -118.249, 'America/Los_Angeles'],
    ['777 Ward Ave, Honolulu HI', 21.2997, -157.852, 'Pacific/Honolulu'],
    ['1 E Grand Ave, Chicago IL', 41.8916, -87.6266, 'America/Chicago'],
    ['600 Ocean Dr, Miami Beach FL', 25.7757, -80.1317, 'America/New_York'],
    // Border and split-state towns.
    ['Indianapolis IN', 39.7684, -86.1581, 'America/New_York'],
    ['Tell City IN', 37.9514, -86.7678, 'America/Chicago'],
    ['Pensacola FL', 30.4213, -87.2169, 'America/Chicago'],
    ['El Paso TX', 31.7619, -106.485, 'America/Denver'],
    ['Boise ID', 43.615, -116.2023, 'America/Denver'],
    ['Ontario OR', 44.0266, -116.9629, 'America/Denver'],
    ['Window Rock AZ (Navajo Nation)', 35.6803, -109.0526, 'America/Denver'],
    ['West Wendover NV', 40.7391, -114.0733, 'America/Denver'],
    ['Juneau AK', 58.3019, -134.4197, 'America/Anchorage'],
    ['Adak AK', 51.88, -176.6581, 'America/Adak'],
  ])('%s (%d, %d) is %s', (_place, latitude, longitude, zone) => {
    expect(finder.zoneAt(latitude, longitude)).toBe(zone);
  });

  it.each([
    ['the Atlantic (Etc/GMT+5)', 30, -70],
    ['Mexico City (America/Mexico_City)', 19.4326, -99.1332],
    ['San Juan PR (America/Caracas)', 18.4655, -66.1057],
  ])('is null for %s, a zone not on the list', (_place, latitude, longitude) => {
    expect(finder.zoneAt(latitude, longitude)).toBeNull();
  });

  it.each([
    ['latitude 91', 91, -84.5],
    ['longitude -181', 38, -181],
    ['NaN', Number.NaN, -84.5],
    ['Infinity', 38, Number.POSITIVE_INFINITY],
  ])('is null, not an exception, for %s', (_label, latitude, longitude) => {
    expect(finder.zoneAt(latitude, longitude)).toBeNull();
  });
});
