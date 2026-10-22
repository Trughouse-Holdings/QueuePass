import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Availability, Event, Location, MyOrder, Order, TicketTier } from '@queuepass/shared';
import { AuthProvider, RequireRole } from '@queuepass/shared/web';
import { App } from '../src/App';
import { releaseOnLogout } from '../src/release-on-logout';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

type Reply = Response | (() => Response | Promise<Response>) | 'network-error';

/** A JSON response, as the Backend would send it. */
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Spec 014: an image's bytes, as `getEventImage` sends them. */
export const blob = (bytes: Uint8Array | number[], type: string, status = 200): Response =>
  new Response(Uint8Array.from(bytes), { status, headers: { 'content-type': type } });

/**
 * Stubs `fetch` with routes keyed by `"METHOD /path"` (query string ignored), and records every
 * request, including its Authorization header and, for writes, its JSON body. Unstubbed routes
 * answer 404.
 */
export function stubApi(routes: Record<string, Reply> = {}) {
  const calls: {
    method: string;
    path: string;
    search: string;
    authorization: string | null;
    contentType: string | null;
    body: unknown;
  }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const req = input instanceof Request ? input : new Request(input);
    const url = new URL(req.url);
    const contentType = req.headers.get('content-type');
    // Spec 014: a multipart body (an image upload) is recorded as its FormData, not parsed as JSON.
    const body =
      req.method === 'GET'
        ? null
        : contentType?.startsWith('multipart/form-data')
          ? { formData: await req.clone().formData() }
          : await req
              .clone()
              .text()
              .then((text) => (text ? JSON.parse(text) : null));
    calls.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      authorization: req.headers.get('authorization'),
      contentType,
      body,
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
      <AuthProvider userManager={um} beforeLogout={releaseOnLogout}>
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
  // Spec 013: the four parts and whether the address service verified them.
  address: '430 W VINE ST, LEXINGTON, KY 40507',
  street: '430 W VINE ST',
  city: 'LEXINGTON',
  state: 'KY',
  zip: '40507',
  addressVerified: true,
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
    maxTicketsPerCustomer: null,
    basePrice: '45.5',
    status: 'SCHEDULED',
    cancelledAt: null,
    reservedSeating: false,
    // Spec 014: always sent by the Backend, empty when the event has no images.
    images: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...over,
  };
};

export const tier = (over: Partial<TicketTier> = {}): TicketTier => ({
  id: 't1',
  eventId: 'e1',
  name: 'General',
  price: '19.99',
  quantity: 100,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

/** Spec 006: tickets left for event `e1`; open, with plenty left, unless overridden. */
export const availability = (over: Partial<Availability> = {}): Availability => ({
  eventId: 'e1',
  ticketsLeft: 100,
  salesClosed: null,
  tiers: [],
  // Spec 016: no per-customer limit unless a test gives one.
  customerLimit: null,
  ...over,
});

export const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  eventId: 'e1',
  tierId: null,
  tierName: null,
  customerUsername: 'customer1',
  quantity: 2,
  unitPrice: '45.50',
  totalPrice: '91.00',
  status: 'CONFIRMED',
  createdAt: '2026-10-03T15:00:00.000Z',
  refundedAt: null,
  tickets: [
    { id: 'k1', code: 'AAAA2222BBBB', status: 'VALID', checkedInAt: null, seat: null },
    { id: 'k2', code: 'CCCC3333DDDD', status: 'VALID', checkedInAt: null, seat: null },
  ],
  ...over,
});

/** Spec 006: one of the customer's own orders, as `GET /me/orders` returns it. */
export const myOrder = (over: Partial<MyOrder> = {}): MyOrder => {
  const e = event();
  return {
    ...order(),
    event: {
      id: e.id,
      name: e.name,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      status: e.status,
      location: { id: e.location.id, name: e.location.name },
    },
    ...over,
  };
};

/**
 * Spec 015: a live seat stream for `GET /events/{id}/seats/stream`. Each connect gets a fresh
 * stream; `send` writes an event to the newest one.
 */
export function seatStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  let connects = 0;
  return {
    reply: (): Response => {
      connects += 1;
      const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    },
    /** Throws until the app has connected, so `waitFor(() => send(…))` waits for it. */
    send: (event: string, data: unknown) => {
      if (!controller) throw new Error('the seat stream is not connected yet');
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    get connects() {
      return connects;
    },
  };
}
