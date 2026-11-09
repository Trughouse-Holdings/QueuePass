import { AddressServiceUnavailableError } from '../../src/address/address-geocoder';
import type { MapPlace, MapSearch } from '../../src/address/map-search';

/** What the fake answers one search with: places, or `unavailable`, which throws. */
export type FakeMapAnswer = MapPlace[] | 'unavailable';

/** One search the fake was asked, in order. */
export type MapCall =
  | { by: 'address'; street: string; city: string; state: string }
  | { by: 'name'; name: string; city: string; state: string };

/**
 * Stands in for the map search in every test app (spec 013 research R16), so no test uses the
 * network. By default every search finds nothing, so an address the fake geocoder does not
 * match stays not verified, as before R16. A test can queue the next answers and read the calls.
 */
export class FakeMapSearch implements MapSearch {
  readonly calls: MapCall[] = [];
  private queued: FakeMapAnswer[] = [];

  /** Answer the next search with `answer`, once; queue several for byAddress then byName. */
  next(answer: FakeMapAnswer): this {
    this.queued.push(answer);
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.queued = [];
  }

  byAddress(parts: { street: string; city: string; state: string }): Promise<MapPlace[]> {
    this.calls.push({ by: 'address', street: parts.street, city: parts.city, state: parts.state });
    return this.answer();
  }

  byName(name: string, where: { city: string; state: string }): Promise<MapPlace[]> {
    this.calls.push({ by: 'name', name, city: where.city, state: where.state });
    return this.answer();
  }

  private answer(): Promise<MapPlace[]> {
    const answer = this.queued.shift() ?? [];
    if (answer === 'unavailable') {
      return Promise.reject(new AddressServiceUnavailableError('Fake map search is unavailable.'));
    }
    return Promise.resolve(answer);
  }
}
