import {
  AddressGeocoder,
  AddressParts,
  AddressServiceUnavailableError,
  GeocodeResult,
} from '../../src/address/address-geocoder';

/** What the fake answers: a geocode result, or `unavailable`, which throws (research R6). */
export type FakeAnswer = GeocodeResult | { kind: 'unavailable' };

/**
 * Stands in for the address service in every test app (spec 013 research R9), so no test uses
 * the network. By default it matches any address, in a standard form like the real service's:
 * trimmed, upper case, ZIP cut to 5 digits.
 */
export class FakeGeocoder implements AddressGeocoder {
  /** Every address looked up, in order. */
  readonly calls: AddressParts[] = [];
  private queued: FakeAnswer[] = [];
  private standing: FakeAnswer | undefined;
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

  reset(): void {
    this.calls.length = 0;
    this.queued = [];
    this.standing = undefined;
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
    const answer = this.queued.shift() ?? this.standing ?? standardForm(parts);
    if (answer.kind === 'unavailable') {
      throw new AddressServiceUnavailableError('Fake address service is unavailable.');
    }
    return answer;
  }
}

function standardForm(parts: AddressParts): GeocodeResult {
  const up = (s: string): string => s.trim().replace(/\s+/g, ' ').toUpperCase();
  return {
    kind: 'match',
    street: up(parts.street),
    city: up(parts.city),
    state: parts.state,
    zip: parts.zip.slice(0, 5),
  };
}
