import { useEffect, useState } from 'react';
import type { ApiClient } from './api-client.js';
import { useAuth } from './auth-provider.js';

/**
 * Spec 014 research R4: an image is read with the signed-in user's token (a plain `<img src>`
 * cannot send one), as a Blob, and shown from an object URL. One shared cache: every component
 * showing the same image uses one request and one URL, revoked when the last of them lets go.
 * After that, reading it again is answered from the browser's HTTP cache (`immutable`). A failed
 * load is tried again when another component acquires the image, and every holder sees the result.
 */
export interface EventImageState {
  /** A page-local `blob:` URL once loaded; `null` while loading, when failed, or not enabled. */
  url: string | null;
  /** The image could not be loaded (a refusal or a network failure). */
  failed: boolean;
}

interface Entry {
  url: string | null;
  failed: boolean;
  /** A request is in flight. */
  loading: boolean;
  users: number;
  listeners: Set<() => void>;
  /** Every user let go; a load still in flight must not create a URL. */
  dropped: boolean;
}

const cache = new Map<string, Entry>();

async function load(api: ApiClient, eventId: string, imageId: string, entry: Entry) {
  entry.loading = true;
  entry.failed = false;
  try {
    const { data, response } = await api.GET('/events/{id}/images/{imageId}', {
      params: { path: { id: eventId, imageId } },
      parseAs: 'blob',
    });
    if (entry.dropped) return;
    if (response.ok && data) entry.url = URL.createObjectURL(data as Blob);
    else entry.failed = true;
  } catch {
    if (entry.dropped) return;
    entry.failed = true;
  } finally {
    entry.loading = false;
  }
  for (const listener of entry.listeners) listener();
}

function acquire(api: ApiClient, eventId: string, imageId: string): Entry {
  let entry = cache.get(imageId);
  if (!entry) {
    entry = {
      url: null,
      failed: false,
      loading: false,
      users: 0,
      listeners: new Set(),
      dropped: false,
    };
    cache.set(imageId, entry);
    void load(api, eventId, imageId, entry);
  } else if (entry.failed && !entry.loading) {
    // A failed load (a network blip, a 5xx) is not kept for as long as anything holds the entry:
    // a new user tries again, and the holders are told the outcome (review of PR #63).
    void load(api, eventId, imageId, entry);
    for (const listener of entry.listeners) listener();
  }
  entry.users += 1;
  return entry;
}

function release(imageId: string, entry: Entry): void {
  entry.users -= 1;
  if (entry.users > 0) return;
  entry.dropped = true;
  if (entry.url) URL.revokeObjectURL(entry.url);
  if (cache.get(imageId) === entry) cache.delete(imageId);
}

/**
 * One event image for as long as the calling component is mounted and `enabled` is true. A
 * failure is a state, never a thrown error, so the rest of the page is unaffected (FR-031).
 */
export function useEventImage(eventId: string, imageId: string, enabled = true): EventImageState {
  const { api } = useAuth();
  // An image already in the cache shows at once, with no placeholder frame in between (a slide
  // mounts the image again, research R11).
  const [state, setState] = useState<EventImageState>(() => {
    const entry = enabled ? cache.get(imageId) : undefined;
    return { url: entry?.url ?? null, failed: entry?.failed ?? false };
  });

  useEffect(() => {
    if (!enabled) {
      setState({ url: null, failed: false });
      return;
    }
    const entry = acquire(api, eventId, imageId);
    const update = () => setState({ url: entry.url, failed: entry.failed });
    entry.listeners.add(update);
    update();
    return () => {
      entry.listeners.delete(update);
      release(imageId, entry);
    };
  }, [api, eventId, imageId, enabled]);

  return state;
}
