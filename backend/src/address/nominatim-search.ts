import { Logger } from '@nestjs/common';
import { US_STATES } from '@queuepass/shared';
import { AddressServiceUnavailableError } from './address-geocoder';
import type { MapPlace, MapSearch } from './map-search';

const STATE_NAMES: ReadonlyMap<string, string> = new Map(US_STATES.map((s) => [s.code, s.name]));
const STATE_CODES: ReadonlySet<string> = new Set(US_STATES.map((s) => s.code));
/** At most this many places are read from one search (research R16). */
const LIMIT = 5;

/**
 * Research R16: who is asking, as OpenStreetMap's Nominatim usage policy requires of every
 * request. It names the project, never a person.
 */
export const USER_AGENT = 'QueuePass/1.0 (+https://github.com/Trughouse-Holdings/QueuePass)';

/**
 * OpenStreetMap's Nominatim search (spec 013 research R16), the second address check. Nothing
 * else knows its URL or response shape. Each search is one call, bounded by `timeoutMs`
 * (4 seconds by default), with no retry. Calls start at least `minIntervalMs` apart (1.1 seconds
 * by default), because the public service allows at most one request a second. A call that would
 * wait in that queue for `maxWaitMs` or more (3 seconds by default) is not queued: it throws
 * `AddressServiceUnavailableError` at once, so a busy moment never holds a save for long.
 */
export class NominatimSearch implements MapSearch {
  private readonly logger = new Logger(NominatimSearch.name);
  private readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly minIntervalMs: number;
  readonly maxWaitMs: number;
  private queue: Promise<void> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;
  /** Calls waiting for their turn. */
  private waiting = 0;

  constructor(options: {
    baseUrl: string;
    timeoutMs?: number;
    minIntervalMs?: number;
    maxWaitMs?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.maxWaitMs = options.maxWaitMs ?? 3000;
  }

  byAddress(parts: { street: string; city: string; state: string }): Promise<MapPlace[]> {
    return this.search({
      street: parts.street,
      city: parts.city,
      state: STATE_NAMES.get(parts.state) ?? parts.state,
    });
  }

  byName(name: string, where: { city: string; state: string }): Promise<MapPlace[]> {
    const state = STATE_NAMES.get(where.state) ?? where.state;
    return this.search({ q: `${name}, ${where.city}, ${state}` });
  }

  /**
   * Waits until this call may start: one at a time, `minIntervalMs` apart. Throws unavailable
   * instead when the calls already waiting would hold this one `maxWaitMs` or more.
   */
  private async turn(): Promise<void> {
    if (this.waiting * this.minIntervalMs >= this.maxWaitMs) {
      throw new AddressServiceUnavailableError('The map search is busy; not queued.');
    }
    this.waiting += 1;
    const mine = this.queue.then(async () => {
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastStart = Date.now();
    });
    this.queue = mine;
    try {
      await mine;
    } finally {
      this.waiting -= 1;
    }
  }

  private async search(params: Record<string, string>): Promise<MapPlace[]> {
    const query = new URLSearchParams({
      ...params,
      countrycodes: 'us',
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(LIMIT),
    });
    const url = `${this.baseUrl}/search?${query.toString()}`;

    await this.turn();
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      text = await response.text();
    } catch (cause) {
      throw new AddressServiceUnavailableError('The map search could not be reached.', { cause });
    }
    if (!response.ok) {
      this.logger.warn(
        `Map search answered ${response.status}: ${text.slice(0, 500).replace(/\s+/g, ' ')}`,
      );
      throw new AddressServiceUnavailableError(
        `The map search answered with status ${response.status}.`,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (cause) {
      throw new AddressServiceUnavailableError('The map search answered with no JSON.', { cause });
    }
    if (!Array.isArray(body)) {
      throw new AddressServiceUnavailableError('The map search answered without a list.');
    }
    return body
      .slice(0, LIMIT)
      .map(placeOf)
      .filter((p): p is MapPlace => p !== null);
  }
}

const field = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * One search result as a place, or null without a usable position. The state comes from
 * `ISO3166-2-lvl4` (`US-KY` → `KY`), kept only when it is on the list; the ZIP code is the first
 * 5 digits of `postcode`, when it starts with them.
 */
function placeOf(raw: unknown): MapPlace | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as {
    lat?: unknown;
    lon?: unknown;
    name?: unknown;
    category?: unknown;
    address?: unknown;
  };
  const latitude = Number(r.lat);
  const longitude = Number(r.lon);
  if (typeof r.lat !== 'string' && typeof r.lat !== 'number') return null;
  if (typeof r.lon !== 'string' && typeof r.lon !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const a = (typeof r.address === 'object' && r.address !== null ? r.address : {}) as Record<
    string,
    unknown
  >;
  const iso = field(a['ISO3166-2-lvl4']);
  const code = iso?.startsWith('US-') ? iso.slice(3) : null;
  const zip = /^\d{5}/.exec(field(a.postcode) ?? '')?.[0] ?? null;
  return {
    name: field(r.name),
    kind: field(r.category),
    houseNumber: field(a.house_number),
    state: code && STATE_CODES.has(code) ? code : null,
    zip,
    location: { latitude, longitude },
  };
}
