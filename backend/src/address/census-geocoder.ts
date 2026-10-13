import { Logger } from '@nestjs/common';
import { US_STATES, formatAddress } from '@queuepass/shared';
import {
  AddressGeocoder,
  AddressParts,
  AddressServiceUnavailableError,
  GeocodeResult,
} from './address-geocoder';

const STATE_CODES: ReadonlySet<string> = new Set(US_STATES.map((s) => s.code));
/** At most this many candidates are listed for an ambiguous address (research R2). */
const MAX_CANDIDATES = 5;

/**
 * The US Census Geocoder's single-address endpoint (spec 013 research R1, R3, R6). The only
 * real `AddressGeocoder`: nothing else knows the Census URL or its response shape.
 * One call, bounded by `timeoutMs` (5 seconds by default), and no retry.
 */
export class CensusGeocoder implements AddressGeocoder {
  private readonly logger = new Logger(CensusGeocoder.name);
  private readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(options: { baseUrl: string; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async lookup(parts: AddressParts): Promise<GeocodeResult> {
    const query = new URLSearchParams({
      street: parts.street,
      city: parts.city,
      state: parts.state,
      zip: parts.zip.slice(0, 5),
      benchmark: 'Public_AR_Current',
      format: 'json',
    });
    const url = `${this.baseUrl}/geocoder/locations/address?${query.toString()}`;

    let response: Response;
    let text: string;
    try {
      // A redirect is not an answer from this endpoint: it is "unavailable", never followed.
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
      text = await response.text();
    } catch (cause) {
      throw new AddressServiceUnavailableError('The address service could not be reached.', {
        cause,
      });
    }

    // Every non-2xx answer, 400 included, means the request or the service is broken, not that
    // the address does not exist: an unknown address is a 200 with no matches. The body (the
    // service's own `errors`, never a secret) goes to the log for the operator (research R6).
    if (!response.ok) {
      this.logger.warn(
        `Address service answered ${response.status}: ${text.slice(0, 500).replace(/\s+/g, ' ')}`,
      );
      throw new AddressServiceUnavailableError(
        `The address service answered with status ${response.status}.`,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (cause) {
      throw new AddressServiceUnavailableError('The address service answered with no JSON.', {
        cause,
      });
    }
    const found = (body as { result?: { addressMatches?: unknown } } | null)?.result
      ?.addressMatches;
    if (!Array.isArray(found)) {
      throw new AddressServiceUnavailableError(
        'The address service answered without result.addressMatches.',
      );
    }

    const distinct = [
      ...new Set(
        found
          .map((m) => (m as { matchedAddress?: unknown } | null)?.matchedAddress)
          .filter((a): a is string => typeof a === 'string'),
      ),
    ];

    if (distinct.length === 0) return { kind: 'none' };
    if (distinct.length === 1) {
      const split = splitMatched(distinct[0]);
      if (split) return { kind: 'match', ...split };
      // A match we cannot read is no better than no match (research R3).
      this.logger.warn(`Address service match cannot be split: "${distinct[0]}"`);
      return { kind: 'none' };
    }
    return {
      kind: 'many',
      candidates: distinct.slice(0, MAX_CANDIDATES).map((raw) => {
        const split = splitMatched(raw);
        return split ? formatAddress(split) : raw;
      }),
    };
  }
}

/**
 * Splits `STREET, CITY, ST, ZIP` from the right (research R3): the last part is the ZIP code,
 * then the state, then the city, and everything before is the street. Null unless it gives a
 * street of at most 200 characters, a city of at most 100 (the columns' limits), a listed state,
 * and a 5-digit ZIP code.
 */
function splitMatched(matched: string): AddressParts | null {
  const pieces = matched.split(',').map((p) => p.trim());
  if (pieces.length < 4) return null;
  const zip = pieces[pieces.length - 1];
  const state = pieces[pieces.length - 2];
  const city = pieces[pieces.length - 3];
  const street = pieces.slice(0, -3).join(', ');
  if (!street || street.length > 200 || !city || city.length > 100) return null;
  if (!STATE_CODES.has(state) || !/^\d{5}$/.test(zip)) return null;
  return { street, city, state, zip };
}
