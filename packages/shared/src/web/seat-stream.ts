import type { components, paths } from '../api-schema.js';
import { apiBaseUrl } from './api-client.js';

/** Typed by the contract (Constitution I): the stream's payloads, from the generated schema. */
export type StreamSeatMap = components['schemas']['SeatMap'];
export type StreamSeatMapChange = components['schemas']['SeatMapChange'];

const STREAM_PATH = '/events/{id}/seats/stream' satisfies keyof paths;

/** Research R9: after a drop or an error status, wait 1, 2, then 5 seconds between tries. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000] as const;

/**
 * `connecting` before the first snapshot, `live` once one arrived, `reconnecting` while waiting to
 * try again, `gone` after a 404 (the event was deleted), `closed` after `close()`.
 */
export type SeatStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'gone' | 'closed';

export interface SeatStream {
  close(): void;
}

/**
 * Spec 015 research R9: reads `streamSeatMap` with `fetch`, so the access token travels in the
 * `Authorization` header like every other call (Constitution V); `EventSource` can't send it, and
 * a token in the URL would reach access logs. `openapi-fetch` can't read a stream, so the path
 * and payload types come from the generated schema instead.
 *
 * Sends only `Authorization` and `Accept`: the CORS policy allows no other request header. Each
 * connect sends a fresh `snapshot` first, which is how a viewer catches up after a drop (FR-010).
 * When the server ends the stream (at token expiry) it reconnects at once with the current token;
 * after a drop or an error status it waits 1, 2, then 5 seconds; after a 404 it stops.
 */
export function openSeatStream(
  eventId: string,
  getToken: () => string | undefined,
  onSnapshot: (map: StreamSeatMap) => void,
  onChange: (change: StreamSeatMapChange) => void,
  opts: { baseUrl?: string; onStatus?: (status: SeatStreamStatus) => void } = {},
): SeatStream {
  const url = `${opts.baseUrl ?? apiBaseUrl()}${STREAM_PATH.replace('{id}', encodeURIComponent(eventId))}`;
  let closed = false;
  let failures = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const status = (s: SeatStreamStatus): void => opts.onStatus?.(s);

  const retryLater = (): void => {
    if (closed) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)];
    failures += 1;
    status('reconnecting');
    timer = setTimeout(() => void connect(), delay);
  };

  async function connect(): Promise<void> {
    if (closed) return;
    controller = new AbortController();
    const token = getToken();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let snapshotSeen = false;
    try {
      const res = await fetch(new Request(url, { headers, signal: controller.signal }));
      if (res.status === 404) {
        closed = true;
        status('gone');
        return;
      }
      if (!res.ok || !res.body) throw new Error(`seat stream answered ${res.status}`);
      await readEvents(res.body, (event, data) => {
        if (event === 'snapshot') {
          snapshotSeen = true;
          failures = 0;
          status('live');
          onSnapshot(JSON.parse(data) as StreamSeatMap);
        } else if (event === 'seats') {
          onChange(JSON.parse(data) as StreamSeatMapChange);
        }
      });
    } catch {
      retryLater();
      return;
    }
    // Ended by the server. After a snapshot that is the planned end at token expiry: reconnect
    // at once. Without one, something is wrong, so wait like after any other failure.
    if (snapshotSeen) void connect();
    else retryLater();
  }

  status('connecting');
  void connect();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      controller?.abort();
      status('closed');
    },
  };
}

/** Parses `text/event-stream` (named events, `data:` lines, comments), dispatching each event. */
async function readEvents(
  body: ReadableStream<Uint8Array>,
  dispatch: (event: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event = '';
  let data: string[] = [];
  const line = (text: string): void => {
    if (text === '') {
      if (data.length > 0) dispatch(event || 'message', data.join('\n'));
      event = '';
      data = [];
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    const value = colon < 0 ? '' : text.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r\n|\r|\n/);
    // A lone \r at the end may be half of \r\n: keep it with the unfinished line.
    pending = lines.pop() ?? '';
    for (const text of lines) line(text);
  }
}
