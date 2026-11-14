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
/** Spec 038: the stream's first event, the venue map (`VenueMap`), with one section of 4 seats. */
const map = (reserved = 0, seq = 5) => ({
  eventId: 'e1',
  seq,
  layoutId: 'lay-1',
  layoutName: 'Club',
  size: { width: 100, height: 60 },
  floorKind: 'NONE',
  floorOutline: null,
  levels: [{ levelId: 'l1', name: 'Standard', rank: 1, color: 'violet', price: '40.00' }],
  sections: [
    {
      sectionId: 's-a',
      name: 'A',
      outline: [
        [0, 0],
        [20, 0],
        [20, 10],
        [0, 10],
      ],
      labelAt: [10, 5],
      counts: [{ levelId: 'l1', open: 4 - reserved, reserved, sold: 0, offSale: 0 }],
    },
  ],
});
/** Spec 038: section A's seats (`getVenueMapSection`), read at `seq`. */
const section = (seq = 5) => ({
  eventId: 'e1',
  seq,
  sectionId: 's-a',
  name: 'A',
  rows: [
    {
      number: 1,
      label: '1',
      seats: [1, 2, 3, 4].map((n) => ({
        number: n,
        label: String(n),
        at: [2 + 4 * n, 5],
        levelId: 'l1',
        state: 'open',
        accessible: false,
      })),
    },
  ],
});
type State = 'open' | 'reserved' | 'sold' | 'offSale';
const change = (seat: number, state: State, from: State = 'open', seq = 6) => ({
  eventId: 'e1',
  seq,
  changes: [{ sectionId: 's-a', row: 1, seat, state, from, levelId: 'l1' }],
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

    const text = `event: venueMap\ndata: ${JSON.stringify(map())}\n\nevent: ping\ndata: {}\n\n`;
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
    first.send('venueMap', map());

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

  it('waits again after a stream that drops before its venue map', async () => {
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

  it('hands over each venue map, the first and any later one', async () => {
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
    s.send('venueMap', map());
    s.send('venueMap', map(1, 9));

    await waitFor(() => expect(snapshots).toHaveLength(2));
    expect(snapshots[1]).toEqual(map(1, 9));
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

/** Stubs fetch by path; a path's replies are used in order, the last one again. */
function stubRoutes(routes: Record<string, (() => Response)[]>) {
  const requests: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      requests.push(req);
      const list = routes[new URL(req.url).pathname];
      if (!list || list.length === 0) return new Response(null, { status: 404 });
      const reply = list.length > 1 ? list.shift()! : list[0];
      return reply();
    }),
  );
  return {
    requests,
    count: (path: string) => requests.filter((r) => r.url === BASE + path).length,
  };
}
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('useSeatStream', () => {
  const api = createApiClient(BASE, () => 'tok');
  const options = { api, getToken: () => 'tok', baseUrl: BASE };
  const SECTION = '/events/e1/venue-map/sections/s-a';
  const counts = (r: { current: { map: unknown } }) =>
    (r.current.map as ReturnType<typeof map> | null)?.sections[0].counts[0];
  const seat = (r: { current: { section: unknown } }, n: number) =>
    (r.current.section as ReturnType<typeof section> | null)?.rows[0].seats[n - 1].state;

  it('keeps the map’s counts and the open section’s seats current (spec 038 R12)', async () => {
    const s = sse();
    const { count } = stubRoutes({
      '/events/e1/venue-map': [() => json(map())],
      '/events/e1/seats/stream': [() => s.response],
      [SECTION]: [() => json(section())],
    });
    const { result, rerender } = renderHook(
      ({ open }: { open: string | null }) =>
        useSeatStream('e1', { ...options, openSectionId: open }),
      { initialProps: { open: null as string | null } },
    );
    await waitFor(() => expect(result.current.map).not.toBeNull());
    expect(result.current.section).toBeNull();
    await waitFor(() => expect(count('/events/e1/seats/stream')).toBe(1));
    act(() => s.send('venueMap', map()));
    await waitFor(() => expect(result.current.status).toBe('live'));

    rerender({ open: 's-a' });
    await waitFor(() => expect(result.current.section).not.toBeNull());

    act(() => s.send('seats', change(2, 'reserved')));
    await waitFor(() => expect(seat(result, 2)).toBe('reserved'));
    expect(counts(result)).toMatchObject({ open: 3, reserved: 1 });

    act(() => s.send('seats', change(2, 'sold', 'reserved', 7)));
    await waitFor(() => expect(seat(result, 2)).toBe('sold'));
    expect(counts(result)).toMatchObject({ open: 3, reserved: 0, sold: 1 });

    // Already in the map and the section (seq 5): skipped.
    act(() => s.send('seats', change(3, 'sold', 'open', 5)));
    act(() => s.send('seats', change(4, 'reserved', 'open', 8)));
    await waitFor(() => expect(seat(result, 4)).toBe('reserved'));
    expect(seat(result, 3)).toBe('open');
    expect(counts(result)).toMatchObject({ open: 2, reserved: 1, sold: 1 });
    expect(count(SECTION)).toBe(1);

    rerender({ open: null });
    expect(result.current.section).toBeNull();
  });

  it('reads the open section again after a reconnect’s map, keeping it shown meanwhile', async () => {
    const first = sse();
    const second = sse();
    const { count } = stubRoutes({
      '/events/e1/venue-map': [() => json(map())],
      '/events/e1/seats/stream': [() => first.response, () => second.response],
      [SECTION]: [() => json(section()), () => json({ ...section(9), seq: 9 })],
    });
    const { result } = renderHook(() => useSeatStream('e1', { ...options, openSectionId: 's-a' }));
    await waitFor(() => expect(result.current.section).not.toBeNull());
    await waitFor(() => expect(count('/events/e1/seats/stream')).toBe(1));
    act(() => first.send('venueMap', map()));
    // The planned end at token expiry; the next stream starts with a fresh map.
    first.end();
    await waitFor(() => expect(count('/events/e1/seats/stream')).toBe(2));
    expect(result.current.section).not.toBeNull();
    act(() => second.send('venueMap', map(1, 9)));
    // The second map is read, and the section is read again for it.
    await waitFor(() => expect(counts(result)).toMatchObject({ open: 3, reserved: 1 }));
    await waitFor(() => expect(count(SECTION)).toBe(3));
    await waitFor(() => expect((result.current.section as { seq: number } | null)?.seq).toBe(9));
  });

  it('tries the open section again after a network error or a 5xx, waiting longer each time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { count } = stubRoutes({
      '/events/e1/venue-map': [() => json(map())],
      '/events/e1/seats/stream': [() => sse().response],
      [SECTION]: [
        () => {
          throw new TypeError('Failed to fetch');
        },
        () => new Response(null, { status: 503 }),
        () => json(section()),
      ],
    });
    const { result } = renderHook(() => useSeatStream('e1', { ...options, openSectionId: 's-a' }));
    await waitFor(() => expect(count(SECTION)).toBe(1));
    expect(result.current.section).toBeNull();
    // The first try again after a second, the next after two.
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(count(SECTION)).toBe(2));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(count(SECTION)).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(result.current.section).not.toBeNull());
    expect(count(SECTION)).toBe(3);
  });

  it('does not try a section again that is not there (404)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { count } = stubRoutes({
      '/events/e1/venue-map': [() => json(map())],
      '/events/e1/seats/stream': [() => sse().response],
      [SECTION]: [() => new Response(null, { status: 404 })],
    });
    renderHook(() => useSeatStream('e1', { ...options, openSectionId: 's-a' }));
    await waitFor(() => expect(count(SECTION)).toBe(1));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(count(SECTION)).toBe(1);
  });

  it('says missing for an event with no venue map (404)', async () => {
    stubRoutes({});
    const { result } = renderHook(() => useSeatStream('e1', options));
    await waitFor(() => expect(result.current.status).toBe('missing'));
    expect(result.current.map).toBeNull();
  });

  it('refresh() reads the map again without emptying it', async () => {
    const { count } = stubRoutes({
      '/events/e1/venue-map': [() => json(map()), () => json(map(2, 9))],
      '/events/e1/seats/stream': [() => sse().response],
    });
    const { result } = renderHook(() => useSeatStream('e1', options));
    await waitFor(() => expect(result.current.map).not.toBeNull());
    act(() => result.current.refresh());
    expect(result.current.map).not.toBeNull();
    await waitFor(() => expect(counts(result)).toMatchObject({ reserved: 2 }));
    expect(count('/events/e1/venue-map')).toBe(2);
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
    expect(requests[0].url).toBe(`${BASE}/events/e1/venue-map`);

    unmount();
    expect(streams[1].signal.aborted).toBe(true);
  });
});
