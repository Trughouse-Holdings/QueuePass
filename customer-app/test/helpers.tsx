import { afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Availability, Event, Location, MyOrder, Order, TicketTier } from '@queuepass/shared';
import { AuthProvider, RequireRole } from '@queuepass/shared/web';
import { App } from '../src/App';
import { releaseOnLogout } from '../src/release-on-logout';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

/** A route's answer; a function is given the request (spec 033: the hold backend reads it). */
type Reply = Response | ((req: Request) => Response | Promise<Response>) | 'network-error';

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
    const res = typeof reply === 'function' ? await reply(req.clone()) : reply;
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

/**
 * Issue #118: a fake clock that moves only when the test advances it, so a countdown reads the
 * exact second however busy the machine is (`shouldAdvanceTime` also moved it with real time, so
 * a test that ran 1 s slower read a countdown 1 s ahead). Testing Library's `waitFor` and
 * `findBy*` step a fake clock themselves, 50 ms at a time, when they see Jest's; the `jest` global
 * is that hook for Vitest's clock. `performance` drives the countdowns; `vi.unstubAllGlobals()` removes the hook.
 */
export function fakeClock() {
  // Spec 030 (T011): keeps the time a file fixed with `fixTimeBeforeFixtures`; a second
  // `useFakeTimers` would otherwise be ignored and leave the timers real.
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  });
  vi.setSystemTime(now);
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
}

/**
 * Before every fixed-date fixture's end that a page test renders (the earliest, in
 * `doors-open.test.tsx`, ends 2026-11-20), so no fixture is past whatever day the tests run.
 */
export const FIXTURE_NOW = Date.parse('2026-10-01T12:00:00.000Z');

/**
 * Spec 030 (research R10, tasks T011): the event page and My tickets decide "ended" from the
 * time, so a test rendering them with fixed-date fixtures fixes the time first, as
 * `add-to-calendar.test.tsx` does. Only `Date` is faked; `fakeClock()` keeps the time.
 */
export function fixTimeBeforeFixtures(now = FIXTURE_NOW): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

/** Spec 017 FR-001: types a valid holder's name, so Confirm can enable. */
export async function typeHolderName(name = 'Jordan Lee') {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Name on tickets' }), {
    target: { value: name },
  });
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
  timeZone: 'America/New_York',
  timeZoneSource: 'DEFAULT',
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
    // Spec 025: doors 1 hour before the start, check-in from 1 hour before doors.
    doorsOpenAt: '2026-12-01T22:00:00.000Z',
    entryOpensAt: '2026-12-01T21:00:00.000Z',
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
  // Spec 017 FR-001: the buyer's name on every ticket; null for orders placed before 017.
  holderName: 'Jordan Lee',
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
      doorsOpenAt: e.doorsOpenAt,
      status: e.status,
      // Spec 019 FR-012: the venue's one-line address.
      location: { id: e.location.id, name: e.location.name, address: e.location.address },
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

/** A seat as hold and release requests name it. */
type HeldPlace = { sectionId: string; row: number; seat: number };

/**
 * Spec 033 (research R6): the Backend as it answers seat clicks on event `e1`, one reservation of
 * `tierId`: each hold adds its seats (201 for the first, 200 after), each release removes them and
 * ends the reservation with the last. With `manual`, each answer waits for `answer()`, so a test
 * can see the click queue. `sections` names each section id, as reservations show it.
 */
export function holdBackend(
  opts: {
    sections?: Record<string, string>;
    tierId?: string | null;
    secondsLeft?: number;
    manual?: boolean;
  } = {},
) {
  const sections = opts.sections ?? { 's-a': 'A' };
  let held: HeldPlace[] = [];
  const waiting: (() => void)[] = [];
  const later = (make: () => Response): Promise<Response> =>
    opts.manual
      ? new Promise((resolve) => waiting.push(() => resolve(make())))
      : Promise.resolve(make());
  const same = (a: HeldPlace, b: HeldPlace) =>
    a.sectionId === b.sectionId && a.row === b.row && a.seat === b.seat;
  const reservationOf = (list: HeldPlace[]) => ({
    eventId: 'e1',
    tierId: opts.tierId === undefined ? 't-vip' : opts.tierId,
    seats: list.map((s) => ({ ...s, section: sections[s.sectionId] ?? '?' })),
    createdAt: '2026-10-20T19:00:00.000Z',
    expiresAt: '2026-10-20T19:05:00.000Z',
    secondsLeft: opts.secondsLeft ?? 300,
  });
  const seatsOf = async (req: Request): Promise<HeldPlace[]> => {
    const text = await req.clone().text();
    return ((text ? JSON.parse(text) : null)?.seats ?? []) as HeldPlace[];
  };
  const order = (a: HeldPlace, b: HeldPlace) =>
    a.sectionId.localeCompare(b.sectionId) || a.row - b.row || a.seat - b.seat;
  return {
    /** The seats held now, as `row-seat` (any section). */
    held: () => held.map((s) => `${s.row}-${s.seat}`),
    answer: async () => {
      await vi.waitFor(() => {
        if (waiting.length === 0) throw new Error('no answer is waiting');
      });
      await act(async () => waiting.shift()?.());
    },
    routes: {
      'GET /me/reservations': () => json(held.length ? [reservationOf(held)] : []),
      'POST /events/e1/reservation': async (req: Request) => {
        const seats = await seatsOf(req);
        return later(() => {
          const created = held.length === 0;
          held = [...held, ...seats].sort(order);
          return json(reservationOf(held), created ? 201 : 200);
        });
      },
      'POST /events/e1/reservation/release': async (req: Request) => {
        const seats = await seatsOf(req);
        return later(() => {
          held = held.filter((h) => !seats.some((s) => same(s, h)));
          return json({ reservation: held.length ? reservationOf(held) : null });
        });
      },
    },
  };
}
