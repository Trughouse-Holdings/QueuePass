import { vi } from 'vitest';

type Reply = Response | (() => Response | Promise<Response>) | 'network-error';

/** A JSON response, as the Backend would send it. */
export const json = (body: unknown, status = 200): Response =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });

/**
 * Stubs `fetch` with routes keyed by `"METHOD /path"` (query string ignored), and records every
 * request. openapi-fetch calls fetch with a single Request object.
 */
export function stubApi(routes: Record<string, Reply>) {
  const calls: { method: string; path: string; search: string }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const req = input instanceof Request ? input : new Request(input);
    const url = new URL(req.url);
    calls.push({ method: req.method, path: url.pathname, search: url.search });
    const reply = routes[`${req.method} ${url.pathname}`];
    if (reply === undefined)
      return json({ error: { code: 'NOT_FOUND', message: 'unstubbed' } }, 404);
    if (reply === 'network-error') throw new TypeError('Failed to fetch');
    const res = typeof reply === 'function' ? await reply() : reply;
    return res.clone();
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetchMock,
    count: (method: string, path: string) =>
      calls.filter((c) => c.method === method && c.path === path).length,
  };
}
