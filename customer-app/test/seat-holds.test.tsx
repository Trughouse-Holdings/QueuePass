import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Reservation, SeatMap } from '@queuepass/shared';
import { availability, event, json, order, renderCustomer, stubApi, tier } from './helpers';

/**
 * Spec 015 US1 (FR-001, FR-002, FR-005–FR-008, FR-012; research R13): pick seats, press Reserve
 * seats, see the countdown, and confirm or release them.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00', quantity: 30 });
const general = tier({ id: 't-gen', name: 'General', price: '40.00', quantity: 40 });

const seatMap = (over: Partial<SeatMap> = {}): SeatMap => ({
  eventId: 'e1',
  reservedSeating: true,
  sections: [
    {
      sectionId: 's-a',
      name: 'A',
      rows: 2,
      seatsPerRow: 6,
      tierId: 't-vip',
      sold: 1,
      taken: [{ row: 1, seat: 2 }],
      reserved: [],
    },
    {
      sectionId: 's-b',
      name: 'B',
      rows: 1,
      seatsPerRow: 4,
      tierId: 't-gen',
      sold: 0,
      taken: [],
      reserved: [],
    },
  ],
  ...over,
});

const reservation = (seats: [number, number][], over: Partial<Reservation> = {}): Reservation => ({
  eventId: 'e1',
  tierId: 't-vip',
  seats: seats.map(([row, seat]) => ({ sectionId: 's-a', section: 'A', row, seat })),
  createdAt: '2026-10-20T19:00:00.000Z',
  expiresAt: '2026-10-20T19:05:00.000Z',
  secondsLeft: 300,
  ...over,
});

type Reply = Response | (() => Response) | 'network-error';
const routes = (extra: Record<string, Reply> = {}) => ({
  'GET /events/e1': json(event({ reservedSeating: true })),
  'GET /events/e1/tiers': json([general, vip]),
  'GET /events/e1/availability': json(
    availability({
      ticketsLeft: 56,
      tiers: [
        { tierId: 't-gen', ticketsLeft: 40 },
        { tierId: 't-vip', ticketsLeft: 16 },
      ],
    }),
  ),
  'GET /events/e1/seats': json(seatMap()),
  'GET /me/reservations': json([]),
  ...extra,
});

const refusal = (code: string, message: string, details?: object) =>
  json({ error: { code, message, ...(details ? { details } : {}) } }, 409);

const seatButton = (row: number, seat: number) =>
  screen.getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${seat}(,|$)`) });
const pick = async (...seats: [number, number][]) => {
  fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
  for (const [row, seat] of seats) fireEvent.click(seatButton(row, seat));
};
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const picks = () =>
  within(screen.getByRole('list', { name: 'Chosen seats' }))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);
const reserved = () =>
  within(screen.getByRole('list', { name: 'Reserved seats' }))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);
/** Fake timers that still let Testing Library's polling run; `performance` drives the countdown. */
const fakeClock = () =>
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  });
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

describe('reserving seats (US1-1; FR-001, FR-005)', () => {
  it('sends the picks, then shows a countdown, Confirm purchase, and Release seats', async () => {
    const { calls } = stubApi(
      routes({
        'POST /events/e1/reservation': json(
          reservation([
            [1, 1],
            [1, 3],
          ]),
          201,
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await pick([1, 1], [1, 3]);
    expect(picks()).toEqual(['Section A, Row 1, Seat 1', 'Section A, Row 1, Seat 3']);
    // Picking alone reserves nothing.
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Confirm purchase' })).toBeNull();

    press('Reserve seats');

    const timer = await screen.findByRole('timer');
    expect(timer).toHaveTextContent('5:00');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      seats: [
        { sectionId: 's-a', row: 1, seat: 1 },
        { sectionId: 's-a', row: 1, seat: 3 },
      ],
    });
    expect(reserved()).toEqual(['Section A, Row 1, Seat 1', 'Section A, Row 1, Seat 3']);
    expect(picks()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Confirm purchase' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Release seats' })).toBeEnabled();
    expect(screen.getByText('Total: $240.00')).toBeInTheDocument();
  });

  it('adds newly picked seats to the reservation with Reserve seats', async () => {
    let n = 0;
    const { calls } = stubApi(
      routes({
        'POST /events/e1/reservation': () =>
          n++ === 0
            ? json(reservation([[1, 1]]), 201)
            : json(
                reservation(
                  [
                    [1, 1],
                    [2, 4],
                  ],
                  { secondsLeft: 250 },
                ),
                200,
              ),
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await pick([1, 1]);
    press('Reserve seats');
    await screen.findByRole('timer');
    fireEvent.click(seatButton(2, 4));
    press('Reserve seats');

    await waitFor(() =>
      expect(reserved()).toEqual(['Section A, Row 1, Seat 1', 'Section A, Row 2, Seat 4']),
    );
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
    expect(reserved()).toEqual(['Section A, Row 1, Seat 4']);
    expect(screen.getByRole('radio', { name: /VIP/ })).toBeChecked();
  });
});

describe('confirming (US1-3; FR-006)', () => {
  it('orders the reserved seats with a requestId and shows them on the confirmation', async () => {
    const placed = order({
      tierId: 't-vip',
      tierName: 'VIP',
      quantity: 2,
      unitPrice: '120.00',
      totalPrice: '240.00',
      tickets: [
        {
          id: 'k1',
          code: 'AAAA2222BBBB',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: 'A', row: 1, seat: 1 },
        },
        {
          id: 'k2',
          code: 'CCCC3333DDDD',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: 'A', row: 1, seat: 3 },
        },
      ],
    });
    const { calls } = stubApi(
      routes({
        'POST /events/e1/reservation': json(
          reservation([
            [1, 1],
            [1, 3],
          ]),
          201,
        ),
        'POST /events/e1/orders': json(placed, 201),
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await pick([1, 1], [1, 3]);
    press('Reserve seats');
    await screen.findByRole('timer');
    press('Confirm purchase');

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    expect(calls.find((c) => c.path === '/events/e1/orders')?.body).toEqual({
      tierId: 't-vip',
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
    ).toEqual(['AAAA2222BBBB, Section A, Row 1, Seat 1', 'CCCC3333DDDD, Section A, Row 1, Seat 3']);
  });
});

describe('the countdown (FR-005, FR-012)', () => {
  it('announces once, in a status region, when 1 minute is left', async () => {
    fakeClock();
    stubApi(routes({ 'POST /events/e1/reservation': json(reservation([[1, 1]]), 201) }));
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);
    press('Reserve seats');
    const timer = await screen.findByRole('timer');
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

  it('at 0:00 says the reservation ran out, hides Confirm purchase, and keeps the picks', async () => {
    fakeClock();
    stubApi(
      routes({
        'POST /events/e1/reservation': json(
          reservation([
            [1, 1],
            [1, 3],
          ]),
          201,
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1], [1, 3]);
    press('Reserve seats');
    await screen.findByRole('timer');

    await advance(300_000);

    expect(screen.getByRole('alert')).toHaveTextContent(/ran out/);
    expect(screen.queryByRole('button', { name: 'Confirm purchase' })).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(picks()).toEqual(['Section A, Row 1, Seat 1', 'Section A, Row 1, Seat 3']);
  });
});

describe('releasing (US1-5, US1-6; FR-007)', () => {
  it('releases a deselected reserved seat alone, and leaves the countdown alone', async () => {
    fakeClock();
    const { calls } = stubApi(
      routes({
        'POST /events/e1/reservation': json(
          reservation([
            [1, 1],
            [1, 3],
          ]),
          201,
        ),
        'POST /events/e1/reservation/release': json({
          reservation: reservation([[1, 3]], { secondsLeft: 300 }),
        }),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1], [1, 3]);
    press('Reserve seats');
    const timer = await screen.findByRole('timer');
    await advance(30_000);
    expect(timer).toHaveTextContent('4:30');

    fireEvent.click(seatButton(1, 1));

    await waitFor(() => expect(reserved()).toEqual(['Section A, Row 1, Seat 3']));
    expect(calls.find((c) => c.path === '/events/e1/reservation/release')?.body).toEqual({
      seats: [{ sectionId: 's-a', row: 1, seat: 1 }],
    });
    expect(screen.getByRole('timer')).toHaveTextContent('4:30');
    expect(picks()).toEqual([]);
  });

  it('releases every seat with Release seats', async () => {
    const { calls } = stubApi(
      routes({
        'POST /events/e1/reservation': json(
          reservation([
            [1, 1],
            [1, 3],
          ]),
          201,
        ),
        'POST /events/e1/reservation/release': json({ reservation: null }),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1], [1, 3]);
    press('Reserve seats');
    await screen.findByRole('timer');

    press('Release seats');

    await waitFor(() => expect(screen.queryByRole('timer')).toBeNull());
    expect(calls.find((c) => c.path === '/events/e1/reservation/release')?.body).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm purchase' })).toBeNull();
  });

  it('releases the reservation first when another tier is chosen', async () => {
    const { calls } = stubApi(
      routes({
        'POST /events/e1/reservation': json(reservation([[1, 1]]), 201),
        'POST /events/e1/reservation/release': json({ reservation: null }),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);
    press('Reserve seats');
    await screen.findByRole('timer');

    fireEvent.click(screen.getByRole('radio', { name: /General/ }));

    await waitFor(() =>
      expect(calls.some((c) => c.path === '/events/e1/reservation/release')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('timer')).toBeNull());
    expect(screen.getByRole('radio', { name: /General/ })).toBeChecked();
  });
});

describe('refusals keep the picks (US1-2; FR-002, FR-004a)', () => {
  it('drops seats someone else reserved, says so, and keeps the rest', async () => {
    stubApi(
      routes({
        'POST /events/e1/reservation': refusal(
          'SEAT_TAKEN',
          'Section A, Row 1, Seat 3 is reserved by another customer.',
          {
            seats: [{ section: 'A', row: 1, seat: 3 }],
            reserved: [{ section: 'A', row: 1, seat: 3 }],
          },
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1], [1, 3]);

    press('Reserve seats');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Section A, Row 1, Seat 3 is reserved by another customer.',
    );
    // The seat map reloads after a taken seat, so wait for the form to come back.
    await waitFor(() => expect(picks()).toEqual(['Section A, Row 1, Seat 1']));
    expect(screen.queryByRole('timer')).toBeNull();
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
    await pick([1, 1], [1, 3]);

    press('Reserve seats');

    expect(await screen.findByRole('alert')).toHaveTextContent('Seat 3 is already taken.');
    await waitFor(() => expect(picks()).toEqual(['Section A, Row 1, Seat 1']));
  });

  it('says when a seat in the 2-minute wait can be reserved again, in local time', async () => {
    const availableAt = '2026-10-20T23:02:30.000Z';
    stubApi(
      routes({
        'POST /events/e1/reservation': refusal(
          'SEAT_COOLDOWN',
          'You released Section A, Row 1, Seat 1 less than 2 minutes ago.',
          { seats: [{ section: 'A', row: 1, seat: 1 }], availableAt },
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);

    press('Reserve seats');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Section A, Row 1, Seat 1');
    expect(alert).toHaveTextContent(
      new Date(availableAt).toLocaleTimeString('en-US', { timeStyle: 'short' }),
    );
    expect(picks()).toEqual(['Section A, Row 1, Seat 1']);
  });

  it('says the reservation ran out when Confirm purchase comes too late', async () => {
    stubApi(
      routes({
        'POST /events/e1/reservation': json(reservation([[1, 1]]), 201),
        'POST /events/e1/orders': refusal(
          'RESERVATION_REQUIRED',
          'Your reservation for Early Show ran out. Reserve the seats again to get them.',
          { seats: [{ section: 'A', row: 1, seat: 1 }], expired: true },
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);
    press('Reserve seats');
    await screen.findByRole('timer');

    press('Confirm purchase');

    expect(await screen.findByRole('alert')).toHaveTextContent(/ran out/);
    await waitFor(() => expect(screen.queryByRole('timer')).toBeNull());
    expect(picks()).toEqual(['Section A, Row 1, Seat 1']);
  });

  it('shows the per-customer limit refusal and keeps the picks', async () => {
    stubApi(
      routes({
        'POST /events/e1/reservation': refusal(
          'TICKET_LIMIT_REACHED',
          'Early Show allows 2 tickets per customer, and you already hold 2.',
          { limit: 2, held: 2, remaining: 0, requested: 1 },
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await pick([1, 1]);

    press('Reserve seats');

    expect(await screen.findByRole('alert')).toHaveTextContent('allows 2 tickets per customer');
    expect(picks()).toEqual(['Section A, Row 1, Seat 1']);
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

describe('reserved looks different from sold (US4; FR-012, research R13, R15)', () => {
  const othersReserved = seatMap();
  othersReserved.sections[0].reserved = [{ row: 2, seat: 5 }];

  it("shows another customer's reserved seat as Reserved: its own class, an R, and its name", async () => {
    stubApi(routes({ 'GET /events/e1/seats': json(othersReserved) }));
    renderCustomer({ at: '/events/e1' });
    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));

    const seat = screen.getByRole('button', { name: 'Row 2, Seat 5, reserved' });

    expect(seat).toHaveClass('seat--reserved');
    expect(seat).not.toHaveClass('seat--taken');
    expect(seat).toHaveTextContent('R');
    expect(seat).toBeDisabled();
  });

  it("shows the customer's own reserved seats as theirs", async () => {
    stubApi(routes({ 'GET /me/reservations': json([reservation([[1, 4]])]) }));
    renderCustomer({ at: '/events/e1' });
    await screen.findByRole('timer');

    const seat = screen.getByRole('button', { name: 'Row 1, Seat 4, reserved by you' });

    expect(seat).toHaveClass('seat--mine');
    expect(seat).not.toHaveClass('seat--reserved');
    expect(seat).toHaveAttribute('aria-pressed', 'true');
    expect(seat).toBeEnabled();
  });

  it('keeps sold seats as sold, by class, cross, and name', async () => {
    stubApi(routes({ 'GET /events/e1/seats': json(othersReserved) }));
    renderCustomer({ at: '/events/e1' });
    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));

    const seat = screen.getByRole('button', { name: 'Row 1, Seat 2, sold' });

    expect(seat).toHaveClass('seat--taken');
    expect(seat).toHaveTextContent('✕');
    expect(seat).toBeDisabled();
  });
});
