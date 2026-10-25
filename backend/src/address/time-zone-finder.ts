import { Logger } from '@nestjs/common';
import { isUsTimeZone, type UsTimeZone } from '@queuepass/shared';
import { find } from 'geo-tz/dist/find-now';

/** Injection token for the zone lookup (spec 020 research R1). */
export const TIME_ZONE_FINDER = Symbol('TIME_ZONE_FINDER');

export interface TimeZoneFinder {
  /** The US zone at this place, or null when the place has none on US_TIME_ZONES (R2). */
  zoneAt(latitude: number, longitude: number): UsTimeZone | null;
}

/**
 * Spec 020 research R1: the zone at a place from geo-tz's "same since now" boundaries
 * (timezone-boundary-builder, © OpenStreetMap contributors, ODbL 1.0), shipped inside the
 * package: no network call. `find-now` merges zones whose rules agree from now on, so US land
 * comes back as one of the eight zones. Anything off the list, an out-of-range place, or an error
 * gives null, and the state rule (R3) applies instead of a 500.
 *
 * `find-now` reads the boundary tiles it needs with synchronous file reads, on the request's
 * thread, and keeps them in memory: a few milliseconds on a venue save, only when an address
 * changes (review round 1, m5; measured 27 lookups in 10 ms). Not preloaded at startup:
 * `preCache()` took the process from 33 MB to 831 MB on 2026-10-25, too much for a lookup made
 * on venue saves only.
 */
export class GeoTzFinder implements TimeZoneFinder {
  private readonly logger = new Logger(GeoTzFinder.name);

  zoneAt(latitude: number, longitude: number): UsTimeZone | null {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    // geo-tz throws "Invalid latitude/longitude" outside these ranges.
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    try {
      return find(latitude, longitude).find(isUsTimeZone) ?? null;
    } catch (err) {
      this.logger.warn(
        `Time zone lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
