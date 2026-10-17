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
 * request, with the JSON body of writes. openapi-fetch calls fetch with a single Request object.
 */
export function stubApi(routes: Record<string, Reply>) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const req = input instanceof Request ? input : new Request(input);
    const url = new URL(req.url);
    const text = req.method === 'GET' ? '' : await req.clone().text();
    calls.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      body: text ? JSON.parse(text) : null,
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

/**
 * Spec 015: a live seat stream for `GET /events/{id}/seats/stream`. Each connect gets a fresh
 * stream; `send` writes an event to the newest one.
 */
export function seatStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  return {
    reply: (): Response =>
      new Response(new ReadableStream<Uint8Array>({ start: (c) => (controller = c) }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    /** Throws until the app has connected, so `waitFor(() => send(…))` waits for it. */
    send: (event: string, data: unknown) => {
      if (!controller) throw new Error('the seat stream is not connected yet');
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
  };
}
