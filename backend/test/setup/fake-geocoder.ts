import {
  AddressGeocoder,
  AddressParts,
  AddressServiceUnavailableError,
  GeocodeResult,
  Place,
} from '../../src/address/address-geocoder';

/** What the fake answers: a geocode result, or `unavailable`, which throws (research R6). */
export type FakeAnswer = GeocodeResult | { kind: 'unavailable' };

/**
 * Spec 020 research R1: places the real service gives for R1's addresses, and one in the
 * Atlantic, where geo-tz has no zone on the list (`Etc/GMT+5`).
 */
export const PLACES = {
  lexington: { latitude: 38.0494, longitude: -84.501 },
  louisville: { latitude: 38.1941, longitude: -85.7389 },
  phoenix: { latitude: 33.4465, longitude: -112.0706 },
  denver: { latitude: 39.7459, longitude: -105.019 },
  losAngeles: { latitude: 34.0556, longitude: -118.249 },
  honolulu: { latitude: 21.2997, longitude: -157.852 },
  anchorage: { latitude: 61.2181, longitude: -149.9003 },
  chicago: { latitude: 41.8916, longitude: -87.6266 },
  atlantic: { latitude: 30, longitude: -70 },
} as const satisfies Record<string, Place>;

/**
 * Stands in for the address service in every test app (spec 013 research R9), so no test uses
 * the network. By default it matches any address, in a standard form like the real service's:
 * trimmed, upper case, ZIP cut to 5 digits, placed in Lexington, KY (Eastern; spec 020 T014).
 */
export class FakeGeocoder implements AddressGeocoder {
  /** Every address looked up, in order. */
  readonly calls: AddressParts[] = [];
  private queued: FakeAnswer[] = [];
  private standing: FakeAnswer | undefined;
  private place: Place | null = PLACES.lexington;
  private gate: { release: () => void; started: () => void; wait: Promise<void> } | undefined;

  /** Answer the next lookup with `answer`, once. */
  next(answer: FakeAnswer): this {
    this.queued.push(answer);
    return this;
  }

  /** Answer every lookup with `answer` until `reset()`. */
  always(answer: FakeAnswer): this {
    this.standing = answer;
    return this;
  }

  /** Spec 020: the place of every default match until `reset()`; null for a match without one. */
  placeAt(place: Place | null): this {
    this.place = place;
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.queued = [];
    this.standing = undefined;
    this.place = PLACES.lexington;
    this.gate?.release();
    this.gate = undefined;
  }

  /**
   * Holds the next lookup until `release()` is called. `started` resolves once that lookup has
   * begun, so a test can send a competing request while it waits (research R7).
   */
  pause(): { started: Promise<void>; release: () => void } {
    let release!: () => void;
    let started!: () => void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    this.gate = { release, started, wait };
    return { started: startedPromise, release };
  }

  async lookup(parts: AddressParts): Promise<GeocodeResult> {
    this.calls.push({ ...parts });
    const gate = this.gate;
    if (gate) {
      this.gate = undefined;
      gate.started();
      await gate.wait;
    }
    const answer = this.queued.shift() ?? this.standing ?? standardForm(parts, this.place);
    if (answer.kind === 'unavailable') {
      throw new AddressServiceUnavailableError('Fake address service is unavailable.');
    }
    return answer;
  }
}

function standardForm(parts: AddressParts, location: Place | null): GeocodeResult {
  const up = (s: string): string => s.trim().replace(/\s+/g, ' ').toUpperCase();
  return {
    kind: 'match',
    street: up(parts.street),
    city: up(parts.city),
    state: parts.state,
    zip: parts.zip.slice(0, 5),
    location,
  };
}
