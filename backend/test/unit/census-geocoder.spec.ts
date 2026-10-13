import { Logger } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AddressServiceUnavailableError } from '../../src/address/address-geocoder';
import { CensusGeocoder } from '../../src/address/census-geocoder';

/**
 * Spec 013 research R1, R3, R6, R9: the real client, against a local HTTP server on 127.0.0.1.
 * No test here reaches the network.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const ADDRESS = { street: '430 W Vine St', city: 'Lexington', state: 'KY', zip: '40507' };

const json =
  (body: unknown, status = 200): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
const matches = (...matchedAddresses: string[]): Handler =>
  json({
    result: {
      input: {},
      addressMatches: matchedAddresses.map((matchedAddress) => ({
        matchedAddress,
        coordinates: { x: -84.5, y: 38.0 },
      })),
    },
  });

describe('CensusGeocoder', () => {
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

  const geocoder = async (handler: Handler, timeoutMs = 2000) =>
    new CensusGeocoder({ baseUrl: await serve(handler), timeoutMs });

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    warn.mockRestore();
    await stop();
  });

  it('asks the single-address endpoint with the four parts and a 5-digit ZIP', async () => {
    let url: URL | undefined;
    const g = await geocoder((req, res) => {
      url = new URL(req.url ?? '/', 'http://localhost');
      matches('430 W VINE ST, LEXINGTON, KY, 40507')(req, res);
    });
    await g.lookup({ ...ADDRESS, zip: '40507-1234' });
    expect(url?.pathname).toBe('/geocoder/locations/address');
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      street: '430 W Vine St',
      city: 'Lexington',
      state: 'KY',
      zip: '40507',
      benchmark: 'Public_AR_Current',
      format: 'json',
    });
  });

  it('returns one match split into the standard-form parts', async () => {
    const g = await geocoder(matches('430 W VINE ST, LEXINGTON, KY, 40507'));
    await expect(g.lookup(ADDRESS)).resolves.toEqual({
      kind: 'match',
      street: '430 W VINE ST',
      city: 'LEXINGTON',
      state: 'KY',
      zip: '40507',
    });
  });

  it('splits from the right, so a comma in the street stays in the street', async () => {
    const g = await geocoder(matches('100 MAIN ST, UNIT 5, SPRINGFIELD, IL, 62701'));
    await expect(g.lookup(ADDRESS)).resolves.toEqual({
      kind: 'match',
      street: '100 MAIN ST, UNIT 5',
      city: 'SPRINGFIELD',
      state: 'IL',
      zip: '62701',
    });
  });

  it('returns none for no match', async () => {
    const g = await geocoder(matches());
    await expect(g.lookup(ADDRESS)).resolves.toEqual({ kind: 'none' });
  });

  it.each([
    ['a territory state', '1 CALLE SOL, SAN JUAN, PR, 00901'],
    ['a four-digit ZIP', '430 W VINE ST, LEXINGTON, KY, 4050'],
    ['only three parts', 'LEXINGTON, KY, 40507'],
  ])('returns none, and warns, for one match with %s', async (_label, matched) => {
    const g = await geocoder(matches(matched));
    await expect(g.lookup(ADDRESS)).resolves.toEqual({ kind: 'none' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(matched));
  });

  it('returns a match when every match is the same address', async () => {
    const g = await geocoder(
      matches('430 W VINE ST, LEXINGTON, KY, 40507', '430 W VINE ST, LEXINGTON, KY, 40507'),
    );
    await expect(g.lookup(ADDRESS)).resolves.toMatchObject({ kind: 'match', zip: '40507' });
  });

  it('returns many for distinct matches, in our one-line form, an unsplittable one raw', async () => {
    const g = await geocoder(
      matches(
        '100 N MAIN ST, SPRINGFIELD, IL, 62701',
        '100 S MAIN ST, SPRINGFIELD, IL, 62701',
        '100 MAIN ST, SPRINGFIELD, PR, 00901',
      ),
    );
    await expect(g.lookup(ADDRESS)).resolves.toEqual({
      kind: 'many',
      candidates: [
        '100 N MAIN ST, SPRINGFIELD, IL 62701',
        '100 S MAIN ST, SPRINGFIELD, IL 62701',
        '100 MAIN ST, SPRINGFIELD, PR, 00901',
      ],
    });
  });

  it.each([
    ['a street over 200 characters', `${'1'.repeat(201)}, LEXINGTON, KY, 40507`],
    ['a city over 100 characters', `430 W VINE ST, ${'C'.repeat(101)}, KY, 40507`],
  ])('returns none, and warns, for one match with %s (column limits)', async (_l, matched) => {
    const g = await geocoder(matches(matched));
    await expect(g.lookup(ADDRESS)).resolves.toEqual({ kind: 'none' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(matched));
  });

  it('accepts a street of exactly 200 and a city of exactly 100 characters', async () => {
    const street = 'S'.repeat(200);
    const city = 'C'.repeat(100);
    const g = await geocoder(matches(`${street}, ${city}, KY, 40507`));
    await expect(g.lookup(ADDRESS)).resolves.toEqual({
      kind: 'match',
      street,
      city,
      state: 'KY',
      zip: '40507',
    });
  });

  it('throws unavailable for a redirect, without following it', async () => {
    let followed = false;
    const g = await geocoder((req, res) => {
      if (req.url?.startsWith('/elsewhere')) {
        followed = true;
        matches('430 W VINE ST, LEXINGTON, KY, 40507')(req, res);
        return;
      }
      res.writeHead(302, { Location: '/elsewhere' });
      res.end();
    });
    await expect(g.lookup(ADDRESS)).rejects.toBeInstanceOf(AddressServiceUnavailableError);
    expect(followed).toBe(false);
  });

  it('keeps the first 5 of seven distinct matches', async () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map((n) => `${n} MAIN ST, SPRINGFIELD, IL, 62701`);
    const g = await geocoder(matches(...all));
    await expect(g.lookup(ADDRESS)).resolves.toEqual({
      kind: 'many',
      candidates: [1, 2, 3, 4, 5].map((n) => `${n} MAIN ST, SPRINGFIELD, IL 62701`),
    });
  });

  it('throws unavailable for a 400 with the service errors body, and logs it', async () => {
    // Live 2026-10-12: a bad benchmark or an empty street or city is 400 with this body, while
    // an unknown address is 200 with no matches; so a 400 is a broken request, not "not found".
    const g = await geocoder(json({ errors: ['Invalid benchmark in request'] }, 400));
    await expect(g.lookup(ADDRESS)).rejects.toBeInstanceOf(AddressServiceUnavailableError);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid benchmark in request'));
  });

  it('throws unavailable for a 400 with any other body', async () => {
    const g = await geocoder((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
    });
    await expect(g.lookup(ADDRESS)).rejects.toBeInstanceOf(AddressServiceUnavailableError);
  });

  it.each([404, 429, 500, 503])('throws unavailable for status %i', async (status) => {
    const g = await geocoder(json({ errors: ['nope'] }, status));
    await expect(g.lookup(ADDRESS)).rejects.toBeInstanceOf(AddressServiceUnavailableError);
  });

  it('throws unavailable for a body that is not JSON', async () => {
    const g = await geocoder((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>maintenance</html>');
    });
    await expect(g.lookup(ADDRESS)).rejects.toBeInstanceOf(AddressServiceUnavailableError);
  });

  it.each([
    ['no result', {}],
    ['no addressMatches', { result: {} }],
    ['addressMatches not an array', { result: { addressMatches: 'none' } }],
  ])('throws unavailable for JSON with %s', async (_label, body) => {
    const g = await geocoder(json(body));
    await expect(g.lookup(ADDRESS)).rejects.toBeInstanceOf(AddressServiceUnavailableError);
  });

  it('throws unavailable within 1 second when the server never answers (limit 200 ms)', async () => {
    const g = await geocoder(() => undefined, 200);
    const started = Date.now();
    await expect(g.lookup(ADDRESS)).rejects.toBeInstanceOf(AddressServiceUnavailableError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('succeeds when the server answers at 100 ms (limit 200 ms)', async () => {
    const g = await geocoder((req, res) => {
      setTimeout(() => matches('430 W VINE ST, LEXINGTON, KY, 40507')(req, res), 100);
    }, 200);
    await expect(g.lookup(ADDRESS)).resolves.toMatchObject({ kind: 'match' });
  });

  it('throws unavailable when nothing listens on the port', async () => {
    const baseUrl = await serve(() => undefined);
    await stop();
    const g = new CensusGeocoder({ baseUrl, timeoutMs: 2000 });
    await expect(g.lookup(ADDRESS)).rejects.toBeInstanceOf(AddressServiceUnavailableError);
  });

  it('defaults to a 5-second limit', () => {
    expect(new CensusGeocoder({ baseUrl: 'http://127.0.0.1:1' }).timeoutMs).toBe(5000);
  });
});
