import { beforeEach, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

/**
 * Spec 014 T005: browser features jsdom lacks, for the image tests of every front end. Imported by
 * the `test/setup.ts` of `packages/shared`, the Admin app, and the Customer app.
 *
 * - `URL.createObjectURL` answers `blob:test/<n>`; `URL.revokeObjectURL` records its calls.
 * - `window.matchMedia` matches nothing by default; `setMediaQuery` changes a query per test and
 *   notifies its listeners.
 * - `IntersectionObserver` is absent by default, so galleries count as on screen;
 *   `installIntersectionObserver` installs a controllable one.
 * - `Blob`, `File`, and `FormData` are Node's own, so a `FormData` body of a `Request` can be
 *   sent and read back (jsdom's versions cannot cross into Node's `fetch`).
 */

export const objectUrls = {
  created: [] as string[],
  revoked: [] as string[],
  /** URLs created and not yet revoked. */
  live(): string[] {
    return this.created.filter((u) => !this.revoked.includes(u));
  },
};

let urlCount = 0;

// Node's FormData class, reached through a Response, since jsdom replaces the global.
const NodeFormData = (
  await new Response('a=1', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }).formData()
).constructor as typeof FormData;

Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile, FormData: NodeFormData });

type Listener = (e: MediaQueryListEvent) => void;
const mediaMatches = new Map<string, boolean>();
const mediaListeners = new Map<string, Set<Listener>>();

/** Makes `query` match (or not), and tells the lists already handed out. */
export function setMediaQuery(query: string, matches: boolean): void {
  mediaMatches.set(query, matches);
  for (const l of mediaListeners.get(query) ?? [])
    l({ matches, media: query } as MediaQueryListEvent);
}

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function matchMedia(query: string): MediaQueryList {
  const listeners = mediaListeners.get(query) ?? new Set<Listener>();
  mediaListeners.set(query, listeners);
  return {
    media: query,
    get matches() {
      return mediaMatches.get(query) ?? false;
    },
    onchange: null,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}

export interface FakeIntersectionObserver {
  /** Elements observed now. */
  observed(): Element[];
  /** Reports `el` as on or near the screen (`true`) or not, to every observer watching it. */
  set(el: Element, isIntersecting: boolean): void;
  /** The options each observer was created with. */
  options: (IntersectionObserverInit | undefined)[];
}

/** Installs a controllable `IntersectionObserver` for this test. */
export function installIntersectionObserver(): FakeIntersectionObserver {
  const observers = new Set<{ cb: IntersectionObserverCallback; els: Set<Element> }>();
  const options: (IntersectionObserverInit | undefined)[] = [];
  class IO {
    private entry: { cb: IntersectionObserverCallback; els: Set<Element> };
    constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
      this.entry = { cb, els: new Set() };
      observers.add(this.entry);
      options.push(init);
    }
    observe(el: Element) {
      this.entry.els.add(el);
    }
    unobserve(el: Element) {
      this.entry.els.delete(el);
    }
    disconnect() {
      this.entry.els.clear();
      observers.delete(this.entry);
    }
    takeRecords() {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IO;
  return {
    options,
    observed: () => [...observers].flatMap((o) => [...o.els]),
    set(el, isIntersecting) {
      for (const o of observers) {
        if (!o.els.has(el)) continue;
        o.cb(
          [{ target: el, isIntersecting } as unknown as IntersectionObserverEntry],
          o as unknown as IntersectionObserver,
        );
      }
    },
  };
}

beforeEach(() => {
  urlCount = 0;
  objectUrls.created.length = 0;
  objectUrls.revoked.length = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${++urlCount}`;
    objectUrls.created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    objectUrls.revoked.push(url);
  });
  mediaMatches.clear();
  mediaListeners.clear();
  window.matchMedia = matchMedia;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});
