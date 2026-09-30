import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Event, Location } from '@queuepass/shared';
import { AuthProvider, RequireRole } from '@queuepass/shared/web';
import { App } from '../src/App';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

type Reply = Response | (() => Response | Promise<Response>) | 'network-error';

/** A JSON response, as the Backend would send it. */
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Stubs `fetch` with routes keyed by `"METHOD /path"` (query string ignored), and records every
 * request, including its Authorization header. Unstubbed routes answer 404.
 */
export function stubApi(routes: Record<string, Reply> = {}) {
  const calls: { method: string; path: string; search: string; authorization: string | null }[] =
    [];
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const req = input instanceof Request ? input : new Request(input);
    const url = new URL(req.url);
    calls.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      authorization: req.headers.get('authorization'),
    });
    const reply = routes[`${req.method} ${url.pathname}`];
    if (reply === undefined)
      return json({ error: { code: 'NOT_FOUND', message: 'unstubbed' } }, 404);
    if (reply === 'network-error') throw new TypeError('Failed to fetch');
    const res = typeof reply === 'function' ? await reply() : reply;
    return res.clone();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** The Customer app exactly as main.tsx mounts it, with a fake sign-in and an in-memory router. */
export function renderCustomer({
  at = '/',
  roles = ['customer'],
  username = 'customer1',
  signedIn = true,
}: { at?: string; roles?: string[]; username?: string; signedIn?: boolean } = {}) {
  const um = fakeUserManager(signedIn ? makeUser({ username, roles }) : null);
  return {
    um,
    ...render(
      <AuthProvider userManager={um}>
        <RequireRole role="customer">
          <MemoryRouter initialEntries={[at]}>
            <App />
          </MemoryRouter>
        </RequireRole>
      </AuthProvider>,
    ),
  };
}

const stamp = '2026-09-01T00:00:00.000Z';

export const venue = (over: Partial<Location> = {}): Location => ({
  id: 'v1',
  name: 'Alpha Arena',
  address: '1 Arena Plaza, Louisville, KY',
  seatingCapacity: 22090,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

export const event = (over: Partial<Event> = {}): Event => {
  const location = over.location ?? venue();
  return {
    id: 'e1',
    name: 'Early Show',
    locationId: location.id,
    location,
    startsAt: '2026-12-01T23:00:00.000Z', // 6:00 PM in New York
    endsAt: '2026-12-02T02:00:00.000Z', //   9:00 PM in New York
    totalTicketCapacity: 18000,
    basePrice: '45.5',
    createdAt: stamp,
    updatedAt: stamp,
    ...over,
  };
};
