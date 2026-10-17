import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reservation } from '../seating.js';
import type { ApiClient } from './api-client.js';
import {
  openSeatStream,
  type SeatStreamStatus,
  type StreamSeatMap,
  type StreamSeatMapChange,
} from './seat-stream.js';

export interface SeatStreamOptions {
  /** The app's API client, for the first seat map and, for a customer, their reservations. */
  api: ApiClient;
  /** The signed-in user's current access token; read at every connect. */
  getToken: () => string | undefined;
  baseUrl?: string;
  /** A customer: also load `listMyReservations`, and keep it current (research R13). */
  withMine?: boolean;
  /** Each live change, after it is applied to the map (spec 015 FR-011). */
  onChange?: (change: StreamSeatMapChange) => void;
  /** Each snapshot: the first after connecting, and the catch-up after every reconnect. */
  onSnapshot?: (map: StreamSeatMap) => void;
}

/**
 * `loading` before any map, `connecting` until the stream's first snapshot, `live` while it
 * delivers, `reconnecting` while it is down (the map shown may be behind), `offline` when it
 * stopped, `missing` for an unknown event, `unreachable` when no map could be loaded.
 */
export type LiveSeatStatus =
  'loading' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'missing' | 'unreachable';

export interface LiveSeats {
  map: StreamSeatMap | null;
  /** The caller's active reservations (every event), when `withMine`; `null` until loaded. */
  mine: Reservation[] | null;
  /** When the request that loaded `mine` was sent (`performance.now()`), to tell it from writes. */
  mineAt: number;
  status: LiveSeatStatus;
  /** Loads the map again and reconnects. */
  reload(): void;
  reloadMine(): void;
}

const key = (row: number, seat: number) => `${row}-${seat}`;

/** Research R9, R10: one change applied to a seat map; `sold` is the number taken. */
export function applySeatChange(map: StreamSeatMap, change: StreamSeatMapChange): StreamSeatMap {
  if (change.eventId !== map.eventId) return map;
  return {
    ...map,
    sections: map.sections.map((section) => {
      const here = change.changes.filter((c) => c.sectionId === section.sectionId);
      if (here.length === 0) return section;
      const touched = new Set(here.map((c) => key(c.row, c.seat)));
      const keep = (p: { row: number; seat: number }) => !touched.has(key(p.row, p.seat));
      const taken = [
        ...section.taken.filter(keep),
        ...here.filter((c) => c.state === 'sold').map(({ row, seat }) => ({ row, seat })),
      ];
      const reserved = [
        ...section.reserved.filter(keep),
        ...here.filter((c) => c.state === 'reserved').map(({ row, seat }) => ({ row, seat })),
      ];
      return { ...section, taken, reserved, sold: taken.length };
    }),
  };
}

/**
 * Spec 015 FR-010 (research R9, R13, R14): an event's seat map, kept current by `streamSeatMap`.
 * The map is first read with `getSeatMap`, so the page works as before if streaming is blocked;
 * the stream then replaces it with each snapshot and applies each change. It is closed on unmount
 * and when the event changes, since a browser allows only 6 connections per host.
 *
 * For a customer (`withMine`), `mine` is reloaded whenever a change touches one of their reserved
 * seats (an admin change, a purchase or release in another tab) or reserves any seat (a reservation
 * made in another tab), so every tab shows the same reservation (spec edge case "Two tabs").
 */
export function useSeatStream(eventId: string | null, options: SeatStreamOptions): LiveSeats {
  const [map, setMap] = useState<StreamSeatMap | null>(null);
  const [mine, setMine] = useState<{ list: Reservation[]; at: number } | null>(null);
  const [status, setStatus] = useState<LiveSeatStatus>('loading');
  const [version, setVersion] = useState(0);
  const [mineVersion, setMineVersion] = useState(0);
  const opts = useRef(options);
  opts.current = options;
  const mineRef = useRef<Reservation[] | null>(null);
  const mineRequest = useRef(0);
  const mineTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reloadMine = useCallback(() => setMineVersion((n) => n + 1), []);
  const reload = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    if (!eventId || !opts.current.withMine) return;
    // Only the latest request's answer counts: an older one may predate the caller's own write.
    const request = ++mineRequest.current;
    const at = performance.now();
    void opts.current.api
      .GET('/me/reservations')
      .then(({ data }) => {
        if (request !== mineRequest.current || !data) return;
        mineRef.current = data;
        setMine({ list: data, at });
      })
      .catch(() => undefined);
  }, [eventId, mineVersion]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    let stream: { close(): void } | undefined;
    setMap(null);
    setStatus('loading');

    const changed = (change: StreamSeatMapChange): void => {
      setMap((m) => (m ? applySeatChange(m, change) : m));
      opts.current.onChange?.(change);
      if (!opts.current.withMine) return;
      const touchesMine = change.changes.some((c) =>
        (mineRef.current ?? []).some(
          (r) =>
            r.eventId === change.eventId &&
            r.seats.some(
              (s) => s.sectionId === c.sectionId && s.row === c.row && s.seat === c.seat,
            ),
        ),
      );
      if (touchesMine || change.changes.some((c) => c.state === 'reserved')) {
        clearTimeout(mineTimer.current);
        mineTimer.current = setTimeout(() => setMineVersion((n) => n + 1), 200);
      }
    };

    void (async () => {
      try {
        const { data, response } = await opts.current.api.GET('/events/{id}/seats', {
          params: { path: { id: eventId } },
        });
        if (cancelled) return;
        if (response.status === 404) {
          setStatus('missing');
          return;
        }
        if (response.ok && data) setMap((m) => m ?? data);
      } catch {
        // The stream may still deliver a snapshot.
      }
      if (cancelled) return;
      stream = openSeatStream(
        eventId,
        () => opts.current.getToken(),
        (snapshot) => {
          setMap(snapshot);
          opts.current.onSnapshot?.(snapshot);
        },
        changed,
        {
          baseUrl: opts.current.baseUrl,
          onStatus: (s: SeatStreamStatus) => {
            if (s === 'connecting' || s === 'live' || s === 'reconnecting') setStatus(s);
            else if (s === 'gone') setStatus('offline');
          },
        },
      );
    })();

    return () => {
      cancelled = true;
      stream?.close();
      clearTimeout(mineTimer.current);
    };
  }, [eventId, version]);

  const shown: LiveSeatStatus =
    map === null && (status === 'offline' || status === 'reconnecting') ? 'unreachable' : status;
  return {
    map,
    mine: mine?.list ?? null,
    mineAt: mine?.at ?? 0,
    status: shown,
    reload,
    reloadMine,
  };
}
