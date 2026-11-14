import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { MyReservation as Reservation } from '@queuepass/shared/web';
import {
  event,
  fakeClock,
  fixTimeBeforeFixtures,
  json,
  myOrder,
  order,
  renderCustomer,
  stubApi,
  typeHolderName,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 033 (FR-012 to FR-015, FR-017; research R8, R9): the Cart page lists the customer's active
 * reservations, each bought on its own with Buy tickets before its countdown ends; it reads them
 * again about every second while visible, and opens no seat stream. Spec 038 (FR-022, research
 * R14): each seat with its level and its price now, from `listMyReservations`, and their sum; no
 * ticket types.
 */
let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
});

afterEach(() => {
  visibility = 'visible';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const concert = event({ id: 'e1', name: 'Early Show', reservedSeating: true });
const play = event({
  id: 'e2',
  name: 'Late Play',
  reservedSeating: true,
  basePrice: '30',
  startsAt: '2026-12-03T01:00:00.000Z',
});

/**
 * Spec 038: each seat with its labels, level and price now. Early Show's seat 5 is Courtside at
 * $95, its others Lower sideline at $60; every other event's seats are Standard at $30.
 */
const level = (eventId: string, seat: number) =>
  eventId !== 'e1'
    ? { levelName: 'Standard', price: '30.00' }
    : seat === 5
      ? { levelName: 'Courtside', price: '95.00' }
      : { levelName: 'Lower sideline', price: '60.00' };
const reservation = (
  eventId: string,
  seats: number[],
  over: Partial<Reservation> = {},
): Reservation => ({
  eventId,
  tierId: null,
  seats: seats.map((seat) => ({
    sectionId: 's-a',
    section: 'A',
    row: 1,
    seat,
    rowLabel: '1',
    seatLabel: String(seat),
    ...level(eventId, seat),
  })),
  createdAt: '2026-10-20T19:00:00.000Z',
  expiresAt: '2026-10-20T19:05:00.000Z',
  secondsLeft: 300,
  ...over,
});

type Reply = Response | (() => Response | Promise<Response>) | 'network-error';
const routes = (extra: Record<string, Reply> = {}): Record<string, Reply> => ({
  'GET /events/e1': json(concert),
  'GET /events/e2': json(play),
  'GET /me/orders': json([]),
  ...extra,
});

const entry = (name: string) => screen.findByRole('region', { name });
const reads = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method === 'GET' && c.path === '/me/reservations').length;
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
// Spec 038: seats of two levels, each ticket at its own price, so no single price each.
const placed = order({
  eventId: 'e1',
  tierId: null,
  tierName: null,
  quantity: 2,
  unitPrice: null,
  totalPrice: '155.00',
  tickets: [
    {
      id: 'k1',
      code: 'AAAA2222BBBB',
      status: 'VALID',
      checkedInAt: null,
      seat: { section: 'A', row: 1, seat: 5, rowLabel: '1', seatLabel: '5' },
      price: '95.00',
      levelName: 'Courtside',
    },
    {
      id: 'k2',
      code: 'CCCC3333DDDD',
      status: 'VALID',
      checkedInAt: null,
      seat: { section: 'A', row: 1, seat: 6, rowLabel: '1', seatLabel: '6' },
      price: '60.00',
      levelName: 'Lower sideline',
    },
  ],
});

describe('the cart (FR-012, FR-013)', () => {
  it('says it is empty with no reservations', async () => {
    stubApi(routes({ 'GET /me/reservations': json([]) }));
    renderCustomer({ at: '/cart' });

    expect(
      await screen.findByText(
        "Your cart is empty. Seats you hold on an event's page appear here for 5 minutes.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name on tickets' })).toBeNull();
  });

  it('lists each reservation, newest first, with its event, time, seats with level and price, countdown, and total', async () => {
    stubApi(
      routes({
        'GET /me/reservations': json([
          reservation('e2', [3], { secondsLeft: 200 }),
          reservation('e1', [5, 6], { secondsLeft: 120 }),
        ]),
      }),
    );
    renderCustomer({ at: '/cart' });

    const first = await entry('Late Play');
    const second = await entry('Early Show');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(second).getByRole('link', { name: 'Early Show' })).toHaveAttribute(
      'href',
      '/events/e1',
    );
    expect(second).toHaveTextContent('Dec 1, 2026, 6:00 PM EST');
    // Spec 038: no ticket type; each seat with its own level and price.
    expect(second).not.toHaveTextContent(/each/);
    expect(
      within(within(second).getByRole('list', { name: 'Seats' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Section A, Row 1, Seat 5, Courtside, $95.00',
      'Section A, Row 1, Seat 6, Lower sideline, $60.00',
    ]);
    const timer = within(second).getByRole('timer');
    expect(timer).toHaveClass('hold-countdown');
    expect(timer).toHaveTextContent('2:00');
    expect(second).toHaveTextContent('Total: $155.00');
    expect(within(second).getByRole('link', { name: 'Change seats' })).toHaveAttribute(
      'href',
      '/events/e1',
    );
    expect(within(second).getByRole('button', { name: 'Buy tickets' })).toBeInTheDocument();

    // Another event's seat, at its own level's price.
    expect(within(first).getByRole('list', { name: 'Seats' })).toHaveTextContent(
      'Section A, Row 1, Seat 3, Standard, $30.00',
    );
    expect(within(first).getByRole('timer')).toHaveTextContent('3:20');
    expect(first).toHaveTextContent('Total: $30.00');
    // One name field for the whole cart.
    expect(screen.getAllByRole('textbox', { name: 'Name on tickets' })).toHaveLength(1);
  });

  it("shows 017's message for a name that is not valid, and Buy tickets stays disabled", async () => {
    stubApi(routes({ 'GET /me/reservations': json([reservation('e1', [5])]) }));
    renderCustomer({ at: '/cart' });
    const box = await entry('Early Show');
    const name = screen.getByRole('textbox', { name: 'Name on tickets' });

    expect(within(box).getByRole('button', { name: 'Buy tickets' })).toBeDisabled();
    fireEvent.change(name, { target: { value: '1234' } });
    fireEvent.blur(name);

    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(box).getByRole('button', { name: 'Buy tickets' })).toBeDisabled();
  });
});

describe('buying (FR-014; US1-4)', () => {
  it('sends one order for that reservation and shows the confirmation; the entry leaves the cart', async () => {
    let mine: Reservation[] = [reservation('e1', [5, 6])];
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': () => json(mine),
        'POST /events/e1/orders': () => {
          mine = [];
          return json(placed, 201);
        },
      }),
    );
    renderCustomer({ at: '/cart' });
    const box = await entry('Early Show');
    await typeHolderName();

    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));
    fireEvent.click(within(box).getByRole('button', { name: /Buy tickets|Buying/ }));

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    const posts = calls.filter((c) => c.path === '/events/e1/orders');
    expect(posts).toHaveLength(1);
    // Spec 038: no tierId on a seated order.
    expect(posts[0].body).toEqual({
      holderName: 'Jordan Lee',
      quantity: 2,
      requestId: expect.any(String),
      seats: [
        { sectionId: 's-a', row: 1, seat: 5 },
        { sectionId: 's-a', row: 1, seat: 6 },
      ],
    });
    expect(
      within(within(done).getByRole('list', { name: 'Ticket codes' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'AAAA2222BBBB, Section A, Row 1, Seat 5, Courtside, $95.00',
      'CCCC3333DDDD, Section A, Row 1, Seat 6, Lower sideline, $60.00',
    ]);
    // The prices differ: the confirmation gives no single price each.
    expect(within(done).queryByText('Price each')).toBeNull();
    expect(within(done).getByText('$155.00')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Early Show' })).toBeNull();
  });

  // Spec 034 FR-012 (research R5, R10): the cart confirms with the event page's confirmation, so
  // an order placed after the start says how long the tickets admit; one before says nothing.
  it('says the tickets admit until the end when bought after the start (spec 034)', async () => {
    stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5, 6])]),
        'POST /events/e1/orders': json({ ...placed, createdAt: '2026-12-01T23:30:00.000Z' }, 201),
      }),
    );
    renderCustomer({ at: '/cart' });
    const box = await entry('Early Show');
    await typeHolderName();

    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    expect(
      within(done).getByText(
        'This event has already started (began at 6:00 PM EST). Your tickets admit you until it ends at 9:00 PM EST.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing about a start when bought before it (spec 034)', async () => {
    stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5, 6])]),
        'POST /events/e1/orders': json(placed, 201),
      }),
    );
    renderCustomer({ at: '/cart' });
    const box = await entry('Early Show');
    await typeHolderName();

    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    expect(within(done).queryByText(/already started/)).toBeNull();
  });

  it('buys another event’s reservation with no tierId (spec 038: seated events have no ticket types)', async () => {
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': json([reservation('e2', [3])]),
        'POST /events/e2/orders': json(order({ eventId: 'e2' }), 201),
      }),
    );
    renderCustomer({ at: '/cart' });
    const box = await entry('Late Play');
    await typeHolderName();

    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));

    await screen.findByRole('region', { name: 'Order confirmed' });
    expect(calls.find((c) => c.path === '/events/e2/orders')?.body).toEqual({
      holderName: 'Jordan Lee',
      quantity: 1,
      requestId: expect.any(String),
      seats: [{ sectionId: 's-a', row: 1, seat: 3 }],
    });
  });

  it.each([
    ['a server error', () => json({ error: { code: 'INTERNAL', message: 'x' } }, 500)],
    ['no answer', 'network-error' as const],
  ])(
    'on %s shows the unknown outcome; Check again repeats the same request id',
    async (_, first) => {
      let n = 0;
      const { calls } = stubApi(
        routes({
          'GET /me/reservations': json([reservation('e1', [5])]),
          'POST /events/e1/orders': () => {
            n += 1;
            if (n === 1) {
              if (first === 'network-error') throw new TypeError('Failed to fetch');
              return (first as () => Response)();
            }
            return json(placed, 200);
          },
        }),
      );
      renderCustomer({ at: '/cart' });
      const box = await entry('Early Show');
      await typeHolderName();

      fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));

      expect(
        await screen.findByText("We couldn't confirm whether your order went through."),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      await screen.findByRole('region', { name: 'Order confirmed' });
      const ids = calls
        .filter((c) => c.path === '/events/e1/orders')
        .map((c) => (c.body as { requestId: string }).requestId);
      expect(ids).toHaveLength(2);
      expect(ids[1]).toBe(ids[0]);
    },
  );

  it('shows the buy wait above that entry’s Buy tickets', async () => {
    fakeClock();
    stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5])]),
        'POST /events/e1/orders': json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many tries. You can try again in 2 seconds.',
              details: { action: 'BUY', retryAfterSeconds: 2 },
            },
          },
          429,
        ),
      }),
    );
    renderCustomer({ at: '/cart' });
    const box = await entry('Early Show');
    await typeHolderName();

    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));

    const wait = await within(box).findByText('Too many tries. You can try again in 2 seconds.');
    const buy = within(box).getByRole('button', { name: 'Buy tickets' });
    expect(buy.previousElementSibling).toBe(wait);
    expect(buy).toHaveAttribute('aria-disabled', 'true');
    await advance(2_000);
    expect(buy).not.toHaveAttribute('aria-disabled');
  });

  it('drops the entry with the ran-out message when the order comes too late', async () => {
    stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5])]),
        'POST /events/e1/orders': json(
          {
            error: {
              code: 'RESERVATION_REQUIRED',
              message: 'Your reservation for Early Show ran out.',
              details: { seats: [{ section: 'A', row: 1, seat: 5 }], expired: true },
            },
          },
          409,
        ),
      }),
    );
    renderCustomer({ at: '/cart' });
    const box = await entry('Early Show');
    await typeHolderName();

    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your reservation for Early Show ran out, so its seats were released. You can hold them again in 2 minutes if they are still open.',
    );
    expect(screen.queryByRole('region', { name: 'Early Show' })).toBeNull();
  });
});

describe('the countdown (FR-015)', () => {
  it('warns once at 1 minute and at 0 drops the entry with the alert', async () => {
    fakeClock();
    stubApi(
      routes({
        'GET /me/reservations': json([
          reservation('e1', [5], { secondsLeft: 61 }),
          reservation('e2', [3], { secondsLeft: 250 }),
        ]),
      }),
    );
    renderCustomer({ at: '/cart' });
    await entry('Early Show');

    await advance(1_000);
    expect(screen.getByText('1 minute left to buy your seats.')).toBeInTheDocument();

    await advance(60_000);

    expect(screen.queryByRole('region', { name: 'Early Show' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your reservation for Early Show ran out, so its seats were released.',
    );
    // The other entry keeps its own countdown.
    expect(
      within(screen.getByRole('region', { name: 'Late Play' })).getByRole('timer'),
    ).toHaveTextContent('3:09');
  });
});

describe('live (FR-017; research R8)', () => {
  it('reads the reservations about every second while visible, not while hidden, and at once on becoming visible or focus', async () => {
    fakeClock();
    const { calls } = stubApi(routes({ 'GET /me/reservations': json([reservation('e1', [5])]) }));
    renderCustomer({ at: '/cart' });
    await entry('Early Show');
    const start = reads(calls);

    await advance(3_000);
    expect(reads(calls) - start).toBeGreaterThanOrEqual(2);
    expect(reads(calls) - start).toBeLessThanOrEqual(4);

    visibility = 'hidden';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await advance(1_100);
    const hidden = reads(calls);
    await advance(5_000);
    expect(reads(calls)).toBe(hidden);

    visibility = 'visible';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(reads(calls)).toBe(hidden + 1));

    await advance(100);
    const before = reads(calls);
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(reads(calls)).toBe(before + 1));
  });

  it('drops an entry gone from a read within 2 seconds, saying it ended when no order was placed', async () => {
    fakeClock();
    let mine = [reservation('e1', [5])];
    const { calls } = stubApi(routes({ 'GET /me/reservations': () => json(mine) }));
    renderCustomer({ at: '/cart' });
    await entry('Early Show');

    mine = [];
    await advance(2_000);

    expect(screen.queryByRole('region', { name: 'Early Show' })).toBeNull();
    expect(screen.getByText('Your reservation for Early Show ended.')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/me/orders')).toHaveLength(1);
  });

  it('says the seats were bought, linking My tickets, when an order for that event appeared, by the Backend’s times (review N5)', async () => {
    fakeClock();
    // This browser's clock is weeks ahead of the Backend's: only the Backend's times count.
    vi.setSystemTime(Date.parse('2026-11-15T12:00:00.000Z'));
    let mine = [reservation('e1', [5])];
    stubApi(
      routes({
        'GET /me/reservations': () => json(mine),
        'GET /me/orders': () =>
          json([
            myOrder({
              eventId: 'e1',
              createdAt: '2026-10-20T19:01:00.000Z',
              tickets: [
                {
                  id: 'k1',
                  code: 'AAAA2222BBBB',
                  status: 'VALID',
                  checkedInAt: null,
                  seat: { section: 'A', row: 1, seat: 5, rowLabel: '1', seatLabel: '5' },
                  price: '95.00',
                  levelName: 'Courtside',
                },
              ],
            }),
          ]),
      }),
    );
    renderCustomer({ at: '/cart' });
    await entry('Early Show');

    mine = [];
    await advance(2_000);

    const said = await screen.findByText(/Your seats for Early Show were bought\./);
    expect(within(said).getByRole('link', { name: 'My tickets' })).toHaveAttribute(
      'href',
      '/my-tickets',
    );
  });

  it('says the reservation ended when the only order for that event is older than it (review N5)', async () => {
    fakeClock();
    let mine = [reservation('e1', [5])];
    stubApi(
      routes({
        'GET /me/reservations': () => json(mine),
        'GET /me/orders': json([myOrder({ eventId: 'e1', createdAt: '2026-10-20T18:00:00.000Z' })]),
      }),
    );
    renderCustomer({ at: '/cart' });
    await entry('Early Show');

    mine = [];
    await advance(2_000);

    expect(await screen.findByText('Your reservation for Early Show ended.')).toBeInTheDocument();
  });

  it('says the reservation ended when a later order for that event holds none of its seats (review round 2, N3)', async () => {
    fakeClock();
    let mine = [reservation('e1', [5])];
    stubApi(
      routes({
        'GET /me/reservations': () => json(mine),
        // A general-admission order, or other seats, bought in another tab.
        'GET /me/orders': json([myOrder({ eventId: 'e1', createdAt: '2026-10-20T19:01:00.000Z' })]),
      }),
    );
    renderCustomer({ at: '/cart' });
    await entry('Early Show');

    mine = [];
    await advance(2_000);

    expect(await screen.findByText('Your reservation for Early Show ended.')).toBeInTheDocument();
  });

  it('says it is loading, never empty, until the listed events are read (review S2)', async () => {
    let answer: (r: Response) => void = () => undefined;
    stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5])]),
        'GET /events/e1': () => new Promise<Response>((r) => (answer = r)),
      }),
    );
    renderCustomer({ at: '/cart' });

    expect(await screen.findByText('Loading your cart…')).toBeInTheDocument();
    await act(async () => undefined);
    expect(screen.queryByText(/Your cart is empty/)).toBeNull();
    await act(async () => answer(json(concert)));
    expect(await entry('Early Show')).toBeInTheDocument();
  });

  it('reads an event again after a failure that is not 404, and never hides its reservation (review S2)', async () => {
    fakeClock();
    let n = 0;
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5])]),
        'GET /events/e1': () =>
          n++ === 0 ? json({ error: { code: 'INTERNAL', message: 'x' } }, 500) : json(concert),
      }),
    );
    renderCustomer({ at: '/cart' });
    await waitFor(() => expect(n).toBe(1));
    expect(screen.queryByText(/Your cart is empty/)).toBeNull();

    await advance(1_000);

    expect(await entry('Early Show')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/events/e1')).toHaveLength(2);
  });

  it('after 3 failed reads of an event, shows its entry with "Details unavailable", its seats, and its countdown; Buy tickets still buys (review round 2, S2)', async () => {
    fakeClock();
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5, 6], { secondsLeft: 200 })]),
        'GET /events/e1': json({ error: { code: 'INTERNAL', message: 'x' } }, 500),
        'POST /events/e1/orders': json(order({ eventId: 'e1' }), 201),
      }),
    );
    renderCustomer({ at: '/cart' });
    expect(await screen.findByText('Loading your cart…')).toBeInTheDocument();

    // Tried at about 0, 2, and 5 seconds (each wait counts from the failure, then the next read).
    await advance(6_000);

    const box = await entry('Details unavailable');
    expect(calls.filter((c) => c.path === '/events/e1')).toHaveLength(3);
    expect(within(box).getByRole('link', { name: 'Details unavailable' })).toHaveAttribute(
      'href',
      '/events/e1',
    );
    expect(
      within(within(box).getByRole('list', { name: 'Seats' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Section A, Row 1, Seat 5, Courtside, $95.00',
      'Section A, Row 1, Seat 6, Lower sideline, $60.00',
    ]);
    // The seats' prices come with the reservation, not the event: the total is still shown.
    expect(box).toHaveTextContent('Total: $155.00');
    expect(within(box).getByRole('timer')).toHaveTextContent(/3:1\d/);
    expect(screen.queryByText(/Your cart is empty/)).toBeNull();

    await typeHolderName();
    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));
    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    // Review round 3 (N5): the event is "this event", not "Details unavailable".
    expect(within(done).getByText('this event')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/events/e1/orders')?.body).toEqual({
      holderName: 'Jordan Lee',
      quantity: 2,
      requestId: expect.any(String),
      seats: [
        { sectionId: 's-a', row: 1, seat: 5 },
        { sectionId: 's-a', row: 1, seat: 6 },
      ],
    });
  });

  it("backs off an event's failed reads: 1, 2, 4 seconds, capped at 10 (review round 2, S2)", async () => {
    fakeClock();
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5])]),
        'GET /events/e1': json({ error: { code: 'INTERNAL', message: 'x' } }, 500),
      }),
    );
    renderCustomer({ at: '/cart' });
    const tries = () => calls.filter((c) => c.path === '/events/e1').length;
    await waitFor(() => expect(tries()).toBe(1));

    // Each wait (1, 2, 4, 8, then 10 s) counts from the failure, and the next read of the
    // reservations (once a second) tries again: about 0, 2, 5, 10, 19, 30, 41 seconds.
    const at = async (seconds: number, n: number) => {
      await advance(seconds * 1_000 - elapsed);
      elapsed = seconds * 1_000;
      expect(tries()).toBe(n);
    };
    let elapsed = 0;
    await at(4, 2);
    await at(7, 3);
    await at(15, 4);
    await at(25, 5);
    await at(35, 6);
    await at(40, 6);
    await at(45, 7);
  });

  it('does not list a reservation whose event is gone (404)', async () => {
    stubApi(
      routes({
        'GET /me/reservations': json([reservation('e1', [5])]),
        'GET /events/e1': json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404),
      }),
    );
    renderCustomer({ at: '/cart' });

    expect(await screen.findByText(/Your cart is empty/)).toBeInTheDocument();
  });

  it('keeps an entry whose purchase is in flight when a read lacks it', async () => {
    fakeClock();
    let mine = [reservation('e1', [5])];
    let answer: (r: Response) => void = () => undefined;
    stubApi(
      routes({
        'GET /me/reservations': () => json(mine),
        'POST /events/e1/orders': () => new Promise<Response>((r) => (answer = r)),
      }),
    );
    renderCustomer({ at: '/cart' });
    const box = await entry('Early Show');
    await typeHolderName();
    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));

    mine = [];
    await advance(3_000);
    expect(screen.getByRole('region', { name: 'Early Show' })).toBeInTheDocument();

    await act(async () => answer(json(placed, 201)));
    expect(await screen.findByRole('region', { name: 'Order confirmed' })).toBeInTheDocument();
    expect(screen.queryByText(/ended\./)).toBeNull();
  });

  it('keeps an entry awaiting Check again when a read lacks it', async () => {
    fakeClock();
    let mine = [reservation('e1', [5])];
    stubApi(
      routes({
        'GET /me/reservations': () => json(mine),
        'POST /events/e1/orders': json({ error: { code: 'INTERNAL', message: 'x' } }, 500),
      }),
    );
    renderCustomer({ at: '/cart' });
    const box = await entry('Early Show');
    await typeHolderName();
    fireEvent.click(within(box).getByRole('button', { name: 'Buy tickets' }));
    await screen.findByRole('button', { name: 'Check again' });

    mine = [];
    await advance(3_000);

    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('sends no second read while one is in flight, and applies its answer when it comes', async () => {
    fakeClock();
    const answers: ((r: Response) => void)[] = [];
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': () =>
          answers.length === 0
            ? (answers.push(() => undefined), json([reservation('e1', [5])]))
            : new Promise<Response>((r) => answers.push(r)),
      }),
    );
    renderCustomer({ at: '/cart' });
    await entry('Early Show');
    const start = reads(calls);

    await advance(1_000);
    expect(reads(calls)).toBe(start + 1);
    await advance(3_000);
    expect(reads(calls)).toBe(start + 1);

    await act(async () => answers[1](json([reservation('e1', [5, 6])])));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem'),
      ).toHaveLength(2),
    );
  });

  it('opens no seat stream, with 4 events, each read once and their ticket types never; Buy tickets on the fourth sends at once', async () => {
    const ids = ['e1', 'e2', 'e3', 'e4'];
    const extra: Record<string, Reply> = {};
    for (const id of ['e3', 'e4']) {
      extra[`GET /events/${id}`] = json(event({ id, name: `Show ${id}`, reservedSeating: true }));
      extra[`POST /events/${id}/orders`] = json(order({ eventId: id }), 201);
    }
    const EventSourceSpy = vi.fn();
    vi.stubGlobal('EventSource', EventSourceSpy);
    const { calls } = stubApi(
      routes({
        ...extra,
        'GET /me/reservations': json(ids.map((id) => reservation(id, [1]))),
      }),
    );
    renderCustomer({ at: '/cart' });
    const fourth = await entry('Show e4');
    for (const name of ['Early Show', 'Late Play', 'Show e3']) await entry(name);
    expect(screen.getAllByRole('timer')).toHaveLength(4);

    await typeHolderName();
    fireEvent.click(within(fourth).getByRole('button', { name: 'Buy tickets' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/events/e4/orders')).toHaveLength(1),
    );

    expect(EventSourceSpy).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.path.endsWith('/seats/stream'))).toHaveLength(0);
    for (const id of ids) {
      expect(calls.filter((c) => c.path === `/events/${id}`)).toHaveLength(1);
      // Spec 038 (research R14): each seat's price comes with the reservation.
      expect(calls.filter((c) => c.path === `/events/${id}/tiers`)).toHaveLength(0);
      expect(calls.filter((c) => c.path.startsWith(`/events/${id}/venue-map`))).toHaveLength(0);
    }
  });

  it('stops reading and signs in again on a 401', async () => {
    fakeClock();
    let n = 0;
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': () => {
          n += 1;
          return n === 1
            ? json([reservation('e1', [5])])
            : json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401);
        },
      }),
    );
    const { um } = renderCustomer({ at: '/cart' });
    await entry('Early Show');

    await advance(1_000);
    await waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
    const after = reads(calls);
    await advance(5_000);
    expect(reads(calls)).toBe(after);
  });
});

describe('the top bar (FR-012)', () => {
  it('has a Cart link after My tickets', async () => {
    stubApi(routes({ 'GET /me/reservations': json([]), 'GET /events': json([]) }));
    renderCustomer({ at: '/cart' });

    const nav = await screen.findByRole('navigation');
    const links = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(links.indexOf('Cart')).toBe(links.indexOf('My tickets') + 1);
    expect(within(nav).getByRole('link', { name: 'Cart' })).toHaveAttribute('href', '/cart');
  });
});
