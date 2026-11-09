import { Logger } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AddressServiceUnavailableError } from '../../src/address/address-geocoder';
import { NoMapSearch } from '../../src/address/map-search';
import { NominatimSearch, USER_AGENT } from '../../src/address/nominatim-search';

/**
 * Spec 013 research R16: the real map client, against a local HTTP server on 127.0.0.1. No test
 * here reaches the network.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const json =
  (body: unknown, status = 200): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

/** The KFC Yum! Center as the live service answered a name search on 2026-11-09. */
const YUM = {
  lat: '38.2577',
  lon: '-85.7539',
  name: 'KFC Yum! Center',
  address: {
    leisure: 'KFC Yum! Center',
    house_number: '1',
    road: 'Escalator',
    city: 'Louisville',
    state: 'Kentucky',
    'ISO3166-2-lvl4': 'US-KY',
    postcode: '40202',
    country_code: 'us',
  },
};

describe('NominatimSearch', () => {
  let server: Server | undefined;
  let warn: jest.SpyInstance;

  async function serve(handler: Handler): Promise<string> {
    const s = createServer(handler);
    server = s;
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  }

  async function stop(): Promise<void> {
    const s = server;
    server = undefined;
    if (!s) return;
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }

  const search = async (handler: Handler, timeoutMs = 2000, minIntervalMs = 0) =>
    new NominatimSearch({ baseUrl: await serve(handler), timeoutMs, minIntervalMs });

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    warn.mockRestore();
    await stop();
  });

  it('searches by street, city, and state name in the US, and says who is asking', async () => {
    let req: IncomingMessage | undefined;
    const s = await search((r, res) => {
      req = r;
      json([])(r, res);
    });
    await s.byAddress({ street: '1 Arena Plaza', city: 'Louisville', state: 'KY' });
    const url = new URL(req?.url ?? '/', 'http://localhost');
    expect(url.pathname).toBe('/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      street: '1 Arena Plaza',
      city: 'Louisville',
      state: 'Kentucky',
      countrycodes: 'us',
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
    });
    expect(req?.headers['user-agent']).toBe(USER_AGENT);
    expect(USER_AGENT).not.toMatch(/@/);
  });

  it('searches by name as one line: name, city, state name', async () => {
    let url: URL | undefined;
    const s = await search((r, res) => {
      url = new URL(r.url ?? '/', 'http://localhost');
      json([YUM])(r, res);
    });
    const found = await s.byName('KFC Yum! Center', { city: 'Louisville', state: 'KY' });
    expect(url?.searchParams.get('q')).toBe('KFC Yum! Center, Louisville, Kentucky');
    expect(found).toEqual([
      {
        name: 'KFC Yum! Center',
        houseNumber: '1',
        state: 'KY',
        zip: '40202',
        location: { latitude: 38.2577, longitude: -85.7539 },
      },
    ]);
  });

  it('reads missing, blank, and foreign fields as null, and a ZIP+4 as 5 digits', async () => {
    const s = await search(
      json([
        {
          lat: 1,
          lon: 2,
          name: '',
          address: { postcode: '40202-1234', 'ISO3166-2-lvl4': 'US-PR' },
        },
        { lat: '1', lon: '2' },
        { lat: '1', lon: '2', address: { postcode: 'K1A 0B1', 'ISO3166-2-lvl4': 'CA-ON' } },
      ]),
    );
    expect(await s.byAddress({ street: 'x', city: 'y', state: 'ZZ' })).toEqual([
      {
        name: null,
        houseNumber: null,
        state: null,
        zip: '40202',
        location: { latitude: 1, longitude: 2 },
      },
      {
        name: null,
        houseNumber: null,
        state: null,
        zip: null,
        location: { latitude: 1, longitude: 2 },
      },
      {
        name: null,
        houseNumber: null,
        state: null,
        zip: null,
        location: { latitude: 1, longitude: 2 },
      },
    ]);
  });

  it('skips a result without a usable position, and anything that is not an object', async () => {
    const s = await search(
      json([null, { lon: '2' }, { lat: 'north', lon: '2' }, { lat: {}, lon: '2' }, YUM]),
    );
    const found = await s.byAddress({ street: 'x', city: 'y', state: 'KY' });
    expect(found.map((p) => p.name)).toEqual(['KFC Yum! Center']);
    await stop();
    const t = await search(json(['x', { lat: '1' }, YUM]));
    expect(await t.byAddress({ street: 'x', city: 'y', state: 'KY' })).toHaveLength(1);
  });

  it('reads at most 5 results', async () => {
    const s = await search(json(Array.from({ length: 7 }, () => YUM)));
    expect(await s.byAddress({ street: 'x', city: 'y', state: 'KY' })).toHaveLength(5);
  });

  it.each([
    ['a 429', json({ error: 'slow down' }, 429)],
    ['a 500', json({}, 500)],
    ['a body that is not JSON', (_req: IncomingMessage, res: ServerResponse) => res.end('<html>')],
    ['a body that is not a list', json({ error: 'x' })],
    [
      'a redirect, without following it',
      (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(302, { Location: 'http://127.0.0.1:1/' });
        res.end();
      },
    ],
  ])('throws unavailable for %s', async (_label, handler) => {
    const s = await search(handler);
    await expect(s.byName('x', { city: 'y', state: 'KY' })).rejects.toBeInstanceOf(
      AddressServiceUnavailableError,
    );
  });

  it('throws unavailable when the server never answers (limit 200 ms)', async () => {
    const s = await search(() => undefined, 200);
    const started = Date.now();
    await expect(s.byAddress({ street: 'x', city: 'y', state: 'KY' })).rejects.toBeInstanceOf(
      AddressServiceUnavailableError,
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('throws unavailable when nothing listens on the port', async () => {
    const baseUrl = await serve(json([]));
    await stop();
    const s = new NominatimSearch({ baseUrl, minIntervalMs: 0 });
    await expect(s.byAddress({ street: 'x', city: 'y', state: 'KY' })).rejects.toBeInstanceOf(
      AddressServiceUnavailableError,
    );
  });

  it('starts calls at least the interval apart, also after a failure', async () => {
    const starts: number[] = [];
    let n = 0;
    const s = await search(
      (req, res) => {
        starts.push(Date.now());
        (n++ === 0 ? json({}, 500) : json([]))(req, res);
      },
      2000,
      150,
    );
    await expect(s.byAddress({ street: 'x', city: 'y', state: 'KY' })).rejects.toThrow();
    await Promise.all([
      s.byName('a', { city: 'y', state: 'KY' }),
      s.byName('b', { city: 'y', state: 'KY' }),
    ]);
    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(140);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(140);
  });

  it('defaults to a 4-second limit and calls 1.1 seconds apart', () => {
    const s = new NominatimSearch({ baseUrl: 'http://127.0.0.1:1/' });
    expect(s.timeoutMs).toBe(4000);
    expect(s.minIntervalMs).toBe(1100);
  });
});

describe('NoMapSearch', () => {
  it('finds nothing, without asking anyone', async () => {
    const s = new NoMapSearch();
    expect(await s.byAddress()).toEqual([]);
    expect(await s.byName()).toEqual([]);
  });
});
