import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import type { EventImage } from '../../src/event-image';
import { AuthProvider } from '../../src/web/auth-provider';
import { fakeUserManager, makeUser } from './fake-user-manager';

/** Spec 014: helpers for the image cache and gallery tests. */

export const user = makeUser({ username: 'customer1', roles: ['customer'] });
export const EVENT_ID = 'e1';

export const images = (n: number): EventImage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `img-${i + 1}`,
    position: i + 1,
    contentType: 'image/png',
    byteSize: 10,
  }));

export const imageResponse = (status = 200): Response =>
  status === 200
    ? new Response(new Uint8Array([137, 80, 78, 71]), {
        status,
        headers: { 'content-type': 'image/png' },
      })
    : new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No image.' } }), {
        status,
        headers: { 'content-type': 'application/json' },
      });

type Reply = Response | 'network-error' | (() => Promise<Response>);

/**
 * Stubs `fetch` for image reads: `replies` by image id, any other answered 200 with PNG bytes.
 * Records each request's path and Authorization header.
 */
export function stubImages(replies: Record<string, Reply> = {}) {
  const calls: { path: string; authorization: string | null }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const req = input instanceof Request ? input : new Request(input);
    const path = new URL(req.url).pathname;
    calls.push({ path, authorization: req.headers.get('authorization') });
    const reply = replies[path.split('/').pop() ?? ''];
    if (reply === 'network-error') throw new TypeError('Failed to fetch');
    if (typeof reply === 'function') return reply();
    return (reply ?? imageResponse()).clone();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** Renders `ui` signed in as customer1, with the API at http://api.test. */
export function renderSignedIn(ui: ReactNode) {
  return render(
    <AuthProvider userManager={fakeUserManager(user)} apiBaseUrl="http://api.test">
      {ui}
    </AuthProvider>,
  );
}

/** Lets pending promises (sign-in, fetches) settle, and moves fake timers on by `ms`. */
export async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Lets pending promises settle under real timers. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}
