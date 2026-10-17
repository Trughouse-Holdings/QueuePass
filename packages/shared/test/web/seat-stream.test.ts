import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { openSeatStream } from '../../src/web/seat-stream';
import { useSeatStream } from '../../src/web/use-seat-stream';
import { createApiClient } from '../../src/web/api-client';

/**
 * Spec 015 research R9: the fetch-based Server-Sent Events client. `fetch` is stubbed with
 * responses whose bodies are streams the test writes to.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BASE = 'http://api.test';
const map = (reserved: { row: number; seat: number }[] = []) => ({
  eventId: 'e1',
  reservedSeating: true,
  sections: [
    {
      sectionId: 's-a',
      name: 'A',
      rows: 1,
      seatsPerRow: 4,
      tierId: null,
      sold: 0,
      taken: [],
      reserved,
    },
  ],
});
const change = (seat: number, state: 'open' | 'reserved' | 'sold') => ({
  eventId: 'e1',
  changes: [{ sectionId: 's-a', row: 1, seat, state }],
});

/** A streaming response the test controls. */
function sse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
  const encode = (s: string) => new TextEncoder().encode(s);
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    write: (text: string) => controller.enqueue(encode(text)),
    send: (event: string, data: unknown) =>
      controller.enqueue(encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    end: () => controller.close(),
    fail: () => controller.error(new TypeError('network dropped')),
  };
}

/** Stubs fetch with one reply per call, in order; records each request. */
function stubFetch(replies: (() => Response | Promise<Response>)[]) {
  const requests: Request[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    requests.push(req);
    const reply = replies.shift();
    if (!reply) return new Promise<Response>(() => {});
    return reply();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}

describe('openSeatStream', () => {
  it('parses events across chunk boundaries and ignores ping', async () => {
    const s = sse();
    stubFetch([() => s.response]);
    const snapshots: unknown[] = [];
    const changes: unknown[] = [];
    const stream = openSeatStream(
      'e1',
      () => 'tok',
      (m) => snapshots.push(m),
      (c) => changes.push(c),
      { baseUrl: BASE },
    );

    const text = `event: snapshot\ndata: ${JSON.stringify(map())}\n\nevent: ping\ndata: {}\n\n`;
    s.write(text.slice(0, 17));
    s.write(text.slice(17, 60));
    s.write(text.slice(60));
    s.write('event: seats\r\ndata: ');
    s.write(`${JSON.stringify(change(3, 'reserved'))}\r\n\r\n`);

    await waitFor(() => expect(changes).toEqual([change(3, 'reserved')]));
    expect(snapshots).toEqual([map()]);
    stream.close();
  });

  it('sends only the bearer token and Accept, with the token current at each connect', async () => {
    const first = sse();
    const second = sse();
    const { requests } = stubFetch([() => first.response, () => second.response]);
    let token = 'tok-1';
    const stream = openSeatStream(
      'e1',
      () => token,
      () => undefined,
      () => undefined,
      { baseUrl: BASE },
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    first.send('snapshot', map());

    // The server ends the stream normally at token expiry: reconnect at once, with the new token.
    token = 'tok-2';
    first.end();

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].url).toBe(`${BASE}/events/e1/seats/stream`);
    expect([...requests[0].headers.keys()].sort()).toEqual(['accept', 'authorization']);
    expect(requests[0].headers.get('accept')).toBe('text/event-stream');
    expect(requests[0].headers.get('authorization')).toBe('Bearer tok-1');
    expect(requests[1].headers.get('authorization')).toBe('Bearer tok-2');
    stream.close();
  });

  it('reconnects after a drop or a 401, waiting 1, 2, then 5 seconds, with the current token', async () => {
    vi.useFakeTimers();
    const live = sse();
    const { requests } = stubFetch([
      () => {
        throw new TypeError('Failed to fetch');
      },
      () => new Response(null, { status: 401 }),
      () => new Response(null, { status: 503 }),
      () => live.response,
    ]);
    let token = 'tok-1';
    const stream = openSeatStream(
      'e1',
      () => token,
      () => undefined,
      () => undefined,
      { baseUrl: BASE },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(2);

    token = 'tok-2';
    await vi.advanceTimersByTimeAsync(1_999);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(3);
    expect(requests[2].headers.get('authorization')).toBe('Bearer tok-2');

    await vi.advanceTimersByTimeAsync(4_999);
    expect(requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(4);
    stream.close();
  });

  it('waits again after a stream that drops before its snapshot', async () => {
    vi.useFakeTimers();
    const dropped = sse();
    const { requests } = stubFetch([() => dropped.response, () => sse().response]);
    const stream = openSeatStream(
      'e1',
      () => 'tok',
      () => undefined,
      () => undefined,
      { baseUrl: BASE },
    );
    await vi.advanceTimersByTimeAsync(0);
    dropped.fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(2);
    stream.close();
  });

  it('stops after a 404: the event was deleted', async () => {
    vi.useFakeTimers();
    const { requests } = stubFetch([
      () => new Response(null, { status: 404 }),
      () => sse().response,
    ]);
    const statuses: string[] = [];
    openSeatStream(
      'e1',
      () => 'tok',
      () => undefined,
      () => undefined,
      { baseUrl: BASE, onStatus: (s) => statuses.push(s) },
    );

    await vi.advanceTimersByTimeAsync(30_000);

    expect(requests).toHaveLength(1);
    expect(statuses.at(-1)).toBe('gone');
  });

  it('replaces the state with each new snapshot', async () => {
    const s = sse();
    stubFetch([() => s.response]);
    const snapshots: unknown[] = [];
    const stream = openSeatStream(
      'e1',
      () => 'tok',
      (m) => snapshots.push(m),
      () => undefined,
      { baseUrl: BASE },
    );
    s.send('snapshot', map());
    s.send('snapshot', map([{ row: 1, seat: 2 }]));

    await waitFor(() => expect(snapshots).toHaveLength(2));
    expect(snapshots[1]).toEqual(map([{ row: 1, seat: 2 }]));
    stream.close();
  });

  it('aborts the request on close() and never reconnects', async () => {
    vi.useFakeTimers();
    const s = sse();
    const { requests } = stubFetch([() => s.response, () => sse().response]);
    const stream = openSeatStream(
      'e1',
      () => 'tok',
      () => undefined,
      () => undefined,
      { baseUrl: BASE },
    );
    await vi.advanceTimersByTimeAsync(0);

    stream.close();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(requests[0].signal.aborted).toBe(true);
    expect(requests).toHaveLength(1);
  });
});

describe('useSeatStream', () => {
  const api = createApiClient(BASE, () => 'tok');
  const options = { api, getToken: () => 'tok', baseUrl: BASE };

  it('applies changes to the map: reserved, sold, and open again', async () => {
    const s = sse();
    stubFetch([() => new Response(JSON.stringify(map()), { status: 200 }), () => s.response]);
    const { result } = renderHook(() => useSeatStream('e1', options));
    await waitFor(() => expect(result.current.map).not.toBeNull());
    s.send('snapshot', map());

    act(() => s.send('seats', change(2, 'reserved')));
    await waitFor(() =>
      expect(result.current.map?.sections[0].reserved).toEqual([{ row: 1, seat: 2 }]),
    );

    act(() => s.send('seats', change(2, 'sold')));
    await waitFor(() =>
      expect(result.current.map?.sections[0]).toMatchObject({
        reserved: [],
        taken: [{ row: 1, seat: 2 }],
        sold: 1,
      }),
    );

    act(() => s.send('seats', change(2, 'open')));
    await waitFor(() =>
      expect(result.current.map?.sections[0]).toMatchObject({ reserved: [], taken: [], sold: 0 }),
    );
    expect(result.current.status).toBe('live');
  });

  it('closes the stream on unmount and when the event changes', async () => {
    const { requests } = stubFetch([
      () => new Response(JSON.stringify(map()), { status: 200 }),
      () => sse().response,
      () => new Response(JSON.stringify({ ...map(), eventId: 'e2' }), { status: 200 }),
      () => sse().response,
    ]);
    const { rerender, unmount } = renderHook(({ id }) => useSeatStream(id, options), {
      initialProps: { id: 'e1' },
    });
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith('/stream'))).toHaveLength(1));

    rerender({ id: 'e2' });
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith('/stream'))).toHaveLength(2));
    const streams = requests.filter((r) => r.url.endsWith('/stream'));
    expect(streams[0].signal.aborted).toBe(true);
    expect(streams[1].url).toBe(`${BASE}/events/e2/seats/stream`);

    unmount();
    expect(streams[1].signal.aborted).toBe(true);
  });
});
