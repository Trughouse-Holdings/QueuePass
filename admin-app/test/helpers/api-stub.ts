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

/** Spec 014: an image's bytes, as `getEventImage` sends them. */
export const blob = (bytes: Uint8Array | number[], type: string, status = 200): Response =>
  new Response(Uint8Array.from(bytes), { status, headers: { 'content-type': type } });

/**
 * Stubs `fetch` with routes keyed by `"METHOD /path"` (query string ignored), and records every
 * request, with the JSON body of writes. openapi-fetch calls fetch with a single Request object.
 */
export function stubApi(routes: Record<string, Reply>) {
  const calls: {
    method: string;
    path: string;
    search: string;
    contentType: string | null;
    body: unknown;
  }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const req = input instanceof Request ? input : new Request(input);
    const url = new URL(req.url);
    const contentType = req.headers.get('content-type');
    // Spec 014: a multipart body (an image upload) is recorded as its FormData, not parsed as JSON.
    const body =
      req.method === 'GET'
        ? null
        : contentType?.startsWith('multipart/form-data')
          ? { formData: await req.clone().formData() }
          : await req
              .clone()
              .text()
              .then((text) => (text ? JSON.parse(text) : null));
    calls.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      contentType,
      body,
    });
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
