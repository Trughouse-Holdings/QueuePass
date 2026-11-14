import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { components } from '../api-schema.js';
import type { ApiClient } from './api-client.js';
import { openSeatStream, type SeatStreamStatus, type StreamSeatMapChange } from './seat-stream.js';
import {
  EMPTY_MAP_STATE,
  mapReducer,
  needsLoad,
  type VenueMap,
  type VenueMapSection,
} from './venue-map/map-state.js';

/** The caller's active reservation of one event, as `listMyReservations` gives it (spec 038: each
 * seat with its labels, level and current price). */
export type MyReservation = components['schemas']['Reservation'];

export interface SeatStreamOptions {
  /** The app's API client, for the venue map, its sections and, for a customer, reservations. */
  api: ApiClient;
  /** The signed-in user's current access token; read at every connect. */
  getToken: () => string | undefined;
  baseUrl?: string;
  /** A customer: also load `listMyReservations`, and keep it current (research R13). */
  withMine?: boolean;
  /**
   * Spec 038 (research R11, R12): the section zoomed into. Its seats are loaded
   * (`getVenueMapSection`) and kept current, and loaded again after every new venue map.
   */
  openSectionId?: string | null;
  /** Each live change, after it is applied (spec 015 FR-011). */
  onChange?: (change: StreamSeatMapChange) => void;
  /** Each venue map from the stream: the first after connecting, and the one after a reconnect. */
  onSnapshot?: (map: VenueMap) => void;
}

/**
 * `loading` before any map, `connecting` until the stream's first venue map, `live` while it
 * delivers, `reconnecting` while it is down (the map shown may be behind), `offline` when it
 * stopped, `missing` for an unknown event or one without a venue map (general admission, also
 * after a switch to it while streaming),
 * `unreachable` when no map could be loaded.
 */
export type LiveSeatStatus =
  'loading' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'missing' | 'unreachable';

export interface LiveSeats {
  /** The venue map, its counts kept current. */
  map: VenueMap | null;
  /** The open section's seats, kept current; `null` until loaded, or when none is open. */
  section: VenueMapSection | null;
  /** The caller's active reservations (every event), when `withMine`; `null` until loaded. */
  mine: MyReservation[] | null;
  /** When the request that loaded `mine` was sent (`performance.now()`), to tell it from writes. */
  mineAt: number;
  status: LiveSeatStatus;
  /** Loads the map again and reconnects. */
  reload(): void;
  /** Reads the map (and the open section) again, keeping what is shown until the answer. */
  refresh(): void;
  reloadMine(): void;
}

/**
 * Spec 015 FR-010 (research R9, R13, R14), spec 038 research R11, R12 (T039): an event's venue map
 * and the section zoomed into, kept current by `streamSeatMap`. The map is first read with
 * `getVenueMap`, so the page works as before if streaming is blocked; the stream then replaces it
 * with its own first `venueMap` and sends `seats` changes, applied by `mapReducer` against each
 * `seq`, so a change already in the map or the section is never applied twice (FR-023). After a
 * reconnect, the open section is read again; its seats stay shown meanwhile. A section read with
 * no answer or a 5xx is tried again after 1, 2, 4, 8, then every 10 seconds. The stream is closed
 * on unmount and when the event changes, since a browser allows only 6 connections per host.
 *
 * For a customer (`withMine`), `mine` is reloaded whenever a change touches one of their reserved
 * seats (an admin change, a purchase or release in another tab) or reserves any seat (a reservation
 * made in another tab), so every tab shows the same reservation (spec 015 edge case "Two tabs").
 */
// openapi-fetch's response types widen the contract's `MapPoint` tuple to `number[]`; the
// answers are the contract's `VenueMap` and `VenueMapSection`, so they are typed as such.
export function useSeatStream(eventId: string | null, options: SeatStreamOptions): LiveSeats {
  const [state, dispatch] = useReducer(mapReducer, EMPTY_MAP_STATE);
  // Counts the maps taken, so a section read before the latest map is not stored as current.
  const [mapVersion, setMapVersion] = useState(0);
  const versionRef = useRef(0);
  const [mine, setMine] = useState<{ list: MyReservation[]; at: number } | null>(null);
  const [status, setStatus] = useState<LiveSeatStatus>('loading');
  const [version, setVersion] = useState(0);
  const [mineVersion, setMineVersion] = useState(0);
  const opts = useRef(options);
  opts.current = options;
  const mineRef = useRef<MyReservation[] | null>(null);
  const mineRequest = useRef(0);
  const mineTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasMap = useRef(false);
  const sectionRequest = useRef<string | null>(null);
  // A section read that failed (no answer, or a 5xx) is tried again, 1, 2, 4, 8, then every 10
  // seconds, while the section stays open; `sectionTry` counts the tries, to start the next.
  const [sectionTry, setSectionTry] = useState(0);
  const sectionFailures = useRef(0);
  const sectionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const eventRef = useRef(eventId);
  eventRef.current = eventId;

  const takeMap = useCallback((map: VenueMap): void => {
    hasMap.current = true;
    versionRef.current += 1;
    setMapVersion(versionRef.current);
    dispatch({ type: 'map', map });
  }, []);

  const reloadMine = useCallback(() => setMineVersion((n) => n + 1), []);
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  const refresh = useCallback((): void => {
    const id = eventRef.current;
    if (!id) return;
    void opts.current.api
      .GET('/events/{id}/venue-map', { params: { path: { id } } })
      .then(({ data }) => {
        if (data && eventRef.current === id) takeMap(data as VenueMap);
      })
      .catch(() => undefined);
  }, [takeMap]);

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
    let wasLive = false;
    hasMap.current = false;
    dispatch({ type: 'reset' });
    setStatus('loading');

    const changed = (change: StreamSeatMapChange): void => {
      dispatch({ type: 'change', change });
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
        const { data, response } = await opts.current.api.GET('/events/{id}/venue-map', {
          params: { path: { id: eventId } },
        });
        if (cancelled) return;
        if (response.status === 404) {
          setStatus('missing');
          return;
        }
        // The stream's own first map may have come already; it is newer.
        if (response.ok && data && !hasMap.current) takeMap(data as VenueMap);
      } catch {
        // The stream may still deliver a map.
      }
      if (cancelled) return;
      stream = openSeatStream(
        eventId,
        () => opts.current.getToken(),
        (map) => {
          takeMap(map);
          opts.current.onSnapshot?.(map);
        },
        changed,
        {
          baseUrl: opts.current.baseUrl,
          onStatus: (s: SeatStreamStatus) => {
            if (s === 'live') wasLive = true;
            if (s === 'connecting' || s === 'live' || s === 'reconnecting') setStatus(s);
            // A 404 after the stream was live: the event was deleted (research R9), or switched
            // to general admission (spec 038 FR-010), which has no venue map; the caller reads
            // the event to tell which. Before that, the map loaded, so streaming is just
            // unavailable.
            else if (s === 'gone') setStatus(wasLive ? 'missing' : 'offline');
          },
        },
      );
    })();

    return () => {
      cancelled = true;
      stream?.close();
      clearTimeout(mineTimer.current);
    };
  }, [eventId, version, takeMap]);

  // The open section's seats: loaded when opened, and again after each new map.
  const openSectionId = options.openSectionId ?? null;
  const wanted = openSectionId !== null && state.map !== null && needsLoad(state, openSectionId);
  const sectionKey = eventId && openSectionId ? `${eventId}:${openSectionId}` : null;
  useEffect(() => {
    // Another section (or none): its tries start from the first wait.
    clearTimeout(sectionTimer.current);
    sectionFailures.current = 0;
  }, [sectionKey]);
  useEffect(() => () => clearTimeout(sectionTimer.current), []);
  useEffect(() => {
    if (!eventId || !openSectionId || !wanted) return;
    const key = `${eventId}:${openSectionId}:${mapVersion}:${sectionTry}`;
    if (sectionRequest.current === key) return;
    sectionRequest.current = key;
    clearTimeout(sectionTimer.current);
    const asked = versionRef.current;
    let failed = false;
    void opts.current.api
      .GET('/events/{id}/venue-map/sections/{sectionId}', {
        params: { path: { id: eventId, sectionId: openSectionId } },
      })
      .then(({ data, response }) => {
        if (data) sectionFailures.current = 0;
        // A 4xx (a section no longer in the layout) is not tried again; a new map may close it.
        else failed = response.status >= 500;
        // Read before a newer map: the next request (for that map) brings it.
        if (data && asked === versionRef.current && eventRef.current === eventId) {
          dispatch({ type: 'section', section: data as VenueMapSection });
        }
      })
      .catch(() => {
        failed = true;
      })
      .finally(() => {
        if (sectionRequest.current !== key) return;
        sectionRequest.current = null;
        if (!failed) return;
        const wait = Math.min(1_000 * 2 ** sectionFailures.current, 10_000);
        sectionFailures.current += 1;
        sectionTimer.current = setTimeout(() => setSectionTry((n) => n + 1), wait);
      });
  }, [eventId, openSectionId, wanted, mapVersion, sectionTry]);

  const map = state.map;
  const loaded = openSectionId ? state.sections[openSectionId] : undefined;
  const shown: LiveSeatStatus =
    map === null && (status === 'offline' || status === 'reconnecting') ? 'unreachable' : status;
  return {
    map,
    section: loaded?.section ?? null,
    mine: mine?.list ?? null,
    mineAt: mine?.at ?? 0,
    status: shown,
    reload,
    refresh,
    reloadMine,
  };
}
