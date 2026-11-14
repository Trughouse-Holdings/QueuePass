import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatViewerTime } from '@queuepass/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  availability,
  event,
  fakeClock,
  holdBackend,
  json,
  openSection,
  order,
  renderCustomer,
  seatOf,
  seatedMap,
  stubApi,
  typeHolderName,
  fixTimeBeforeFixtures,
} from './helpers';
import type { Reservation } from '../src/seats';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 015 US1 (FR-001, FR-002, FR-005–FR-008, FR-012; research R13), as spec 033 changes the
 * Customer app's flow: click seats to hold them, see the countdown, buy them from the cart, or
 * click them again to release them.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Spec 038: a venue map of sections A (2 rows of 6, Row 1 Seat 2 sold) and B (1 row of 4), every
// seat Standard at $40.
const arena = (over: { reservedA?: [number, number][] } = {}) =>
  seatedMap([
    {
      sectionId: 's-a',
      name: 'A',
      rows: 2,
      seatsPerRow: 6,
      sold: [[1, 2]],
      reserved: over.reservedA ?? [],
    },
    { sectionId: 's-b', name: 'B', rows: 1, seatsPerRow: 4 },
  ]);

const reservation = (seats: [number, number][], over: Partial<Reservation> = {}): Reservation => ({
  eventId: 'e1',
  tierId: null,
  seats: seats.map(([row, seat]) => ({
    sectionId: 's-a',
    section: 'A',
    row,
    seat,
    rowLabel: String(row),
    seatLabel: String(seat),
    levelName: 'Standard',
    price: '40.00',
  })),
  createdAt: '2026-10-20T19:00:00.000Z',
  expiresAt: '2026-10-20T19:05:00.000Z',
  secondsLeft: 300,
  ...over,
});

type Reply = Response | ((req: Request) => Response | Promise<Response>) | 'network-error';
const routes = (extra: Record<string, Reply> = {}) => ({
  'GET /events/e1': json(event({ reservedSeating: true, layoutId: 'lay-1', basePrice: '40.00' })),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 15 })),
  ...arena().routes,
  'GET /me/reservations': json([]),
  ...extra,
});

const refusal = (code: string, message: string, details?: object) =>
  json({ error: { code, message, ...(details ? { details } : {}) } }, 409);

const seatButton = (row: number, seat: number) => seatOf(row, seat);
const mineName = (row: number, seat: number) =>
  `Row ${row}, Seat ${seat}, Standard, $40, held by you`;
/** Spec 033 (FR-001), spec 038: each click on the map's section A holds the seat at once. */
const pick = async (...seats: [number, number][]) => {
  await openSection('A');
  for (const [row, seat] of seats) {
    fireEvent.click(seatButton(row, seat));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: mineName(row, seat) })).toBeInTheDocument(),
    );
  }
};
const line = (row: number, seat: number) => `Section A, Row ${row}, Seat ${seat}, Standard, $40.00`;
const yourSeats = () => screen.queryByRole('region', { name: 'Your seats' });
const reserved = () =>
  within(yourSeats()!)
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
/** The hold backend's routes on top of this file's. */
const withHolds = (
  b = holdBackend({ sections: { 's-a': 'A', 's-b': 'B' } }),
  extra: Record<string, Reply> = {},
) => stubApi(routes({ ...b.routes, ...extra }));

describe('holding seats (US1-1; FR-001, FR-005; spec 033 FR-001, FR-010)', () => {
  it('holds each clicked seat, then shows the countdown, the seats, the total, and Add to cart', async () => {
    const { calls } = withHolds();
    renderCustomer({ at: '/events/e1' });

    await pick([1, 1], [1, 3]);

    const timer = within(yourSeats()!).getByRole('timer');
    expect(timer).toHaveTextContent('5:00');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { seats: [{ sectionId: 's-a', row: 1, seat: 1 }] },
      { seats: [{ sectionId: 's-a', row: 1, seat: 3 }] },
    ]);
    expect(reserved()).toEqual([line(1, 1), line(1, 3)]);
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Confirm purchase' })).toBeNull();
    expect(screen.getByText('Total: $80.00')).toBeInTheDocument();
  });

  it('adds a seat clicked later to the reservation', async () => {
    const { calls } = withHolds(holdBackend({ sections: { 's-a': 'A' }, secondsLeft: 250 }));
    renderCustomer({ at: '/events/e1' });

    await pick([1, 1]);
    fireEvent.click(seatButton(2, 4));

    await waitFor(() => expect(reserved()).toEqual([line(1, 1), line(2, 4)]));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { seats: [{ sectionId: 's-a', row: 1, seat: 1 }] },
      { seats: [{ sectionId: 's-a', row: 2, seat: 4 }] },
    ]);
  });

  it('shows an active reservation from My reservations on load', async () => {
    stubApi(
      routes({
        'GET /me/reservations': json([
          reservation([[2, 2]], { eventId: 'other' }),
          reservation([[1, 4]], { secondsLeft: 125 }),
        ]),
      }),
    );
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('timer')).toHaveTextContent('2:05');
    expect(reserved()).toEqual([line(1, 4)]);
    // Spec 038 (research R14): the map is open at once while seats are held.
    expect(screen.getByRole('group', { name: 'Arena map' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose seats' })).toBeNull();
  });
});

describe('buying from the cart (US1-3; FR-006; spec 033 FR-011, FR-014)', () => {
  it('orders the held seats with a requestId and shows them on the confirmation', async () => {
    const ticket = (id: string, code: string, seat: number) => ({
      id,
      code,
      status: 'VALID' as const,
      checkedInAt: null,
      seat: { section: 'A', row: 1, seat, rowLabel: '1', seatLabel: String(seat) },
      price: '40.00',
      levelName: 'Standard',
    });
    const placed = order({
      quantity: 2,
      unitPrice: '40.00',
      totalPrice: '80.00',
      tickets: [ticket('k1', 'AAAA2222BBBB', 1), ticket('k2', 'CCCC3333DDDD', 3)],
    });
    const { calls } = withHolds(holdBackend(), {
      'POST /events/e1/orders': json(placed, 201),
    });
    renderCustomer({ at: '/events/e1' });

    await pick([1, 1], [1, 3]);
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    const entry = await screen.findByRole('region', { name: 'Early Show' });
    await typeHolderName();
    fireEvent.click(within(entry).getByRole('button', { name: 'Buy tickets' }));

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    // Spec 038 (R10): a seated order names no ticket type.
    expect(calls.find((c) => c.path === '/events/e1/orders')?.body).toEqual({
      holderName: 'Jordan Lee',
      quantity: 2,
      requestId: expect.any(String),
      seats: [
        { sectionId: 's-a', row: 1, seat: 1 },
        { sectionId: 's-a', row: 1, seat: 3 },
      ],
    });
    expect(
      within(within(done).getByRole('list', { name: 'Ticket codes' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([`AAAA2222BBBB, ${line(1, 1)}`, `CCCC3333DDDD, ${line(1, 3)}`]);
  });
});

describe('the countdown (FR-005, FR-012)', () => {
  it('announces once, in a status region, when 1 minute is left', async () => {
    fakeClock();
    withHolds();
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);
    const timer = within(yourSeats()!).getByRole('timer');
    expect(timer).toHaveAttribute('aria-live', 'off');

    await advance(239_000);
    expect(timer).toHaveTextContent('1:01');
    expect(screen.queryByText(/1 minute left/)).toBeNull();

    await advance(1_000);
    expect(timer).toHaveTextContent('1:00');
    const status = screen.getByText(/1 minute left/);
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(status.closest('[role="timer"]')).toBeNull();

    await advance(10_000);
    expect(screen.getAllByText(/1 minute left/)).toHaveLength(1);
  });

  it('keeps its empty status regions in the page without drawing them as notes (T046)', async () => {
    fakeClock();
    withHolds();
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);
    await advance(10_000);
    const empty = screen.getAllByRole('status').filter((s) => s.textContent === '');
    expect(empty.length).toBeGreaterThanOrEqual(2);
    for (const region of empty) expect(region).not.toHaveClass('note');

    await advance(240_000);
    expect(screen.getByText(/1 minute left/)).toHaveClass('note');
  });

  it('at 0:00 says the reservation ran out and drops the Your seats box', async () => {
    fakeClock();
    withHolds();
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1], [1, 3]);

    await advance(300_000);

    expect(screen.getByRole('alert')).toHaveTextContent(/ran out/);
    expect(yourSeats()).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to cart' })).toBeNull();
  });
});

describe('releasing (US1-5, US1-6; FR-007; spec 033 US2)', () => {
  it('releases a clicked held seat alone, and leaves the countdown alone', async () => {
    fakeClock();
    const { calls } = withHolds();
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1], [1, 3]);
    await advance(30_000);
    expect(within(yourSeats()!).getByRole('timer')).toHaveTextContent('4:30');

    fireEvent.click(seatButton(1, 1));

    await waitFor(() => expect(reserved()).toEqual([line(1, 3)]));
    expect(calls.find((c) => c.path === '/events/e1/reservation/release')?.body).toEqual({
      seats: [{ sectionId: 's-a', row: 1, seat: 1 }],
    });
    expect(within(yourSeats()!).getByRole('timer')).toHaveTextContent('4:30');
  });

  it('ends the reservation when every held seat is clicked', async () => {
    const { calls } = withHolds();
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1], [1, 3]);

    fireEvent.click(seatButton(1, 1));
    fireEvent.click(seatButton(1, 3));

    await waitFor(() => expect(screen.queryByRole('timer')).toBeNull());
    expect(calls.filter((c) => c.path === '/events/e1/reservation/release')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Add to cart' })).toBeNull();
  });

  it('never releases when another section is opened, and holds its seats in the same reservation (spec 038)', async () => {
    const { calls } = withHolds();
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);

    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    fireEvent.click(screen.getByRole('button', { name: /^Section B,/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Row 1, Seat 2, Standard, $40, open' }),
    );
    await screen.findByRole('button', { name: mineName(1, 2) });

    expect(calls.some((c) => c.path === '/events/e1/reservation/release')).toBe(false);
    expect(reserved()).toEqual([line(1, 1), 'Section B, Row 1, Seat 2, Standard, $40.00']);
    expect(screen.getAllByRole('timer')).toHaveLength(1);
  });
});

describe('refusals keep the held seats (US1-2; FR-002, FR-004a)', () => {
  it('drops a seat someone else reserved, says so, and keeps the rest', async () => {
    const b = holdBackend();
    let n = 0;
    withHolds(b, {
      'POST /events/e1/reservation': (req) =>
        n++ === 0
          ? b.routes['POST /events/e1/reservation'](req)
          : refusal('SEAT_TAKEN', 'Section A, Row 1, Seat 3 is reserved by another customer.', {
              seats: [{ section: 'A', row: 1, seat: 3 }],
              reserved: [{ section: 'A', row: 1, seat: 3 }],
            }),
    });
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);

    fireEvent.click(seatButton(1, 3));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Section A, Row 1, Seat 3 is reserved by another customer.',
    );
    await waitFor(() => expect(reserved()).toEqual([line(1, 1)]));
  });

  it('says a sold seat is sold', async () => {
    stubApi(
      routes({
        'POST /events/e1/reservation': refusal(
          'SEAT_TAKEN',
          'Section A, Row 1, Seat 3 is already taken.',
          { seats: [{ section: 'A', row: 1, seat: 3 }] },
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await openSection('A');

    fireEvent.click(seatButton(1, 3));

    expect(await screen.findByRole('alert')).toHaveTextContent('Seat 3 is already taken.');
    expect(yourSeats()).toBeNull();
  });

  // Spec 020 FR-023: not an event time, so the customer's own zone, with its abbreviation.
  it('says when a seat in the 2-minute wait can be held again, in local time', async () => {
    const availableAt = '2026-10-20T23:02:30.000Z';
    stubApi(
      routes({
        'POST /events/e1/reservation': refusal(
          'SEAT_COOLDOWN',
          'Your reservation of Section A, Row 1, Seat 1 ended less than 2 minutes ago.',
          { seats: [{ section: 'A', row: 1, seat: 1 }], availableAt },
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await openSection('A');

    fireEvent.click(seatButton(1, 1));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Section A, Row 1, Seat 1');
    expect(alert).toHaveTextContent(`again at ${formatViewerTime(availableAt)}.`);
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const abbr = new Intl.DateTimeFormat('en-US', { timeZone: own, timeZoneName: 'short' })
      .formatToParts(new Date(availableAt))
      .find((p) => p.type === 'timeZoneName')?.value;
    expect(formatViewerTime(availableAt).endsWith(` ${abbr}`)).toBe(true);
    expect(seatButton(1, 1)).toHaveAccessibleName('Row 1, Seat 1, Standard, $40, open');
  });

  it('says the reservation ran out when Buy tickets comes too late', async () => {
    withHolds(holdBackend(), {
      'POST /events/e1/orders': refusal(
        'RESERVATION_REQUIRED',
        'Your reservation for Early Show ran out. Reserve the seats again to get them.',
        { seats: [{ section: 'A', row: 1, seat: 1 }], expired: true },
      ),
    });
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    const entry = await screen.findByRole('region', { name: 'Early Show' });

    await typeHolderName();
    fireEvent.click(within(entry).getByRole('button', { name: 'Buy tickets' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ran out/);
    await waitFor(() => expect(screen.queryByRole('timer')).toBeNull());
  });

  it('shows the per-customer limit refusal and keeps the held seats', async () => {
    const b = holdBackend();
    let n = 0;
    withHolds(b, {
      'POST /events/e1/reservation': (req) =>
        n++ === 0
          ? b.routes['POST /events/e1/reservation'](req)
          : refusal(
              'TICKET_LIMIT_REACHED',
              'Early Show allows 2 tickets per customer, and you already hold 2.',
              { limit: 2, held: 2, remaining: 0, requested: 2 },
            ),
    });
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);

    fireEvent.click(seatButton(1, 3));

    expect(await screen.findByRole('alert')).toHaveTextContent('allows 2 tickets per customer');
    expect(reserved()).toEqual([line(1, 1)]);
  });
});

describe('logging out (US1-7; FR-008)', () => {
  it('releases every reservation before signing out', async () => {
    const { calls } = stubApi(routes({ 'POST /me/reservations/release': json({ released: 2 }) }));
    const { um } = renderCustomer({ at: '/' });

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(um.signoutRedirect).toHaveBeenCalled());
    const release = calls.find((c) => c.path === '/me/reservations/release');
    expect(release).toMatchObject({
      method: 'POST',
      authorization: expect.stringMatching(/^Bearer /),
    });
    expect(um.calls.slice(-2)).toEqual(['removeUser', 'signoutRedirect']);
  });

  it('still signs out when the release fails', async () => {
    stubApi(routes({ 'POST /me/reservations/release': 'network-error' }));
    const { um } = renderCustomer({ at: '/' });

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(um.signoutRedirect).toHaveBeenCalled());
  });
});

describe('held looks different from sold (US4; FR-012, research R13, R15; spec 038 FR-019)', () => {
  const othersHeld = arena({ reservedA: [[2, 5]] });

  it("shows another customer's held seat as held: hollow, its own class, and its name", async () => {
    stubApi(routes(othersHeld.routes));
    renderCustomer({ at: '/events/e1' });
    await openSection('A');

    const seat = screen.getByRole('button', { name: 'Row 2, Seat 5, Standard, $40, held' });

    expect(seat).toHaveClass('venue-map__seat--held');
    expect(seat).not.toHaveClass('venue-map__seat--sold');
    expect(seat.querySelector('.venue-map__dot--hollow')).not.toBeNull();
    expect(seat).toHaveAttribute('aria-disabled', 'true');
  });

  it("shows the customer's own held seats as theirs", async () => {
    stubApi(
      routes({
        ...arena({ reservedA: [[1, 4]] }).routes,
        'GET /me/reservations': json([reservation([[1, 4]])]),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await screen.findByRole('timer');
    await openSection('A');

    const seat = screen.getByRole('button', { name: mineName(1, 4) });

    expect(seat).toHaveClass('venue-map__seat--mine');
    expect(seat).not.toHaveClass('venue-map__seat--held');
    expect(seat.querySelector('.venue-map__mark--check')).not.toBeNull();
    expect(seat).toHaveAttribute('aria-pressed', 'true');
    expect(seat).not.toHaveAttribute('aria-disabled');
  });

  it('keeps sold seats as sold, by class, cross, and name', async () => {
    stubApi(routes(othersHeld.routes));
    renderCustomer({ at: '/events/e1' });
    await openSection('A');

    const seat = screen.getByRole('button', { name: 'Row 1, Seat 2, Standard, $40, sold' });

    expect(seat).toHaveClass('venue-map__seat--sold');
    expect(seat.querySelector('.venue-map__mark--cross')).not.toBeNull();
    expect(seat).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('review round 1 (T047)', () => {
  it('totals only the held seats (FR-006)', async () => {
    withHolds();
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1], [1, 3]);

    expect(screen.getByText('Total: $80.00')).toBeInTheDocument();
  });

  it('says the event no longer exists when the seat stream answers 404', async () => {
    let streams = 0;
    stubApi(
      routes({
        'GET /events/e1/seats/stream': () =>
          streams++ === 0
            ? new Response(
                new ReadableStream({
                  start: (c) => {
                    c.enqueue(
                      new TextEncoder().encode(
                        `event: venueMap\ndata: ${JSON.stringify(arena().map)}\n\n`,
                      ),
                    );
                    c.close();
                  },
                }),
                { status: 200, headers: { 'content-type': 'text/event-stream' } },
              )
            : json({ error: { code: 'NOT_FOUND', message: 'No event' } }, 404),
      }),
    );
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText('This event no longer exists.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Arena map' })).toBeNull();
  });
});
