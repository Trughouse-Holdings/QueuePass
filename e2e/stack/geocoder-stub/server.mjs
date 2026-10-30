// Spec 022 (research R4, FR-010): a local stand-in for the US Census Geocoder, for the browser-test
// stack only. It answers `GET /geocoder/locations/address` in the shape the Backend's
// CensusGeocoder reads (backend/src/address/census-geocoder.ts): one match, with its standard
// form and real coordinates, for each address in addresses.json; no match for anything else. The
// stack never calls an outside service; docker-compose.yml keeps the real one.
//
// Spec 024 (research R10): one fixed outage. A lookup whose street is `0 Outage Way` (any case,
// surrounding spaces ignored) is answered 503, which the Backend reads as the address service
// being unavailable, so a browser test can save a venue while "the service is down".
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = 8081;
const OUTAGE_STREET = '0 Outage Way';
const addresses = JSON.parse(readFileSync(new URL('./addresses.json', import.meta.url), 'utf8'));
const same = (a, b) =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase();

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' });
  if (req.method === 'GET' && url.pathname === '/geocoder/locations/address') {
    const q = (k) => url.searchParams.get(k);
    if (same(q('street'), OUTAGE_STREET)) {
      console.log(`lookup "${q('street')}, ${q('city')}, ${q('state')} ${q('zip')}": outage`);
      return json(res, 503, { errors: ['stand-in outage'] });
    }
    const found = addresses.filter(
      (a) =>
        same(a.street, q('street')) &&
        same(a.city, q('city')) &&
        same(a.state, q('state')) &&
        same(a.zip, q('zip')),
    );
    const addressMatches = found.map((a) => ({
      matchedAddress: a.matchedAddress,
      coordinates: { x: a.x, y: a.y },
    }));
    console.log(
      `lookup "${q('street')}, ${q('city')}, ${q('state')} ${q('zip')}": ${found.length}`,
    );
    return json(res, 200, { result: { input: {}, addressMatches } });
  }
  return json(res, 404, { errors: ['not found'] });
}).listen(PORT, () => console.log(`geocoder stub on :${PORT}, ${addresses.length} addresses`));
