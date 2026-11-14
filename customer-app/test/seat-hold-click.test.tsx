import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { formatViewerTime } from '@queuepass/shared';
import type { Reservation } from '../src/seats';
import {
  STANDARD,
  availability,
  event,
  fakeClock,
  fixTimeBeforeFixtures,
  holdBackend,
  json,
  openSection,
  renderCustomer,
  seatedMap,
  stubApi,
  mapDrawing,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 033 (FR-001 to FR-011, FR-016, FR-019; research R6, R7, R9, R10): on a seated event a click
 * on an open seat holds it at once and a click on a held seat releases it, one request at a time in
 * click order; the Your seats box shows the countdown, the seats, the total, and Add to cart; every
 * hold and release is announced; refusals are alerts naming the seat. Spec 038 (research R14): the
 * seats are those of a section zoomed into on the venue map, each named with its level and price.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Spec 038: a second level, for a hold of seats of two levels (FR-021). */
const BALCONY = {
  levelId: 'l-bal',
  name: 'Balcony',
  rank: 2,
  color: 'blue' as const,
  price: '25.00',
};
const arena = seatedMap(
  [
    { sectionId: 's-a', name: 'A', rows: 2, seatsPerRow: 12 },
    { sectionId: 's-b', name: 'B', rows: 1, seatsPerRow: 4, levelId: BALCONY.levelId },
  ],
  { levels: [STANDARD, BALCONY] },
);

const reservation = (seats: number[], over: Partial<Reservation> = {}): Reservation => ({
  eventId: 'e1',
  tierId: null,
  seats: seats.map((seat) => ({
    sectionId: 's-a',
    section: 'A',
    row: 1,
    seat,
    rowLabel: '1',
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
  'GET /events/e1': json(
    event({ reservedSeating: true, layoutId: 'lay-1', basePrice: '25.00', priceMax: '40.00' }),
  ),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 28 })),
  ...arena.routes,
  'GET /me/reservations': json([]),
  ...extra,
});

const refusal = (code: string, message: string, details?: object, status = 409) =>
  json({ error: { code, message, ...(details ? { details } : {}) } }, status);

/** The hold backend's routes on top of this file's. */
function withBackend(
  b: { routes: ReturnType<typeof holdBackend>['routes'] },
  extra: Record<string, Reply> = {},
) {
  return stubApi(routes({ ...b.routes, ...extra }));
}
const backend = (opts: { secondsLeft?: number; manual?: boolean } = {}) => {
  const b = holdBackend({
    ...opts,
    sections: { 's-a': 'A', 's-b': 'B' },
    seatInfo: (p) =>
      p.sectionId === 's-b' ? { levelName: BALCONY.name, price: BALCONY.price } : {},
  });
  return { ...b, held: () => b.held().map((k) => Number(k.split('-')[1])) };
};

const seat = (n: number, row = 1) =>
  within(mapDrawing()).getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${n}, `) });
/** Spec 038: a seat's accessible name in section A (Standard, $40) in a state. */
const named = (n: number, state: string) => `Row 1, Seat ${n}, Standard, $40, ${state}`;
/** Spec 038: Section A's seats, as Choose seats and a click on the section show them. */
const openA = () => openSection('A');
/** The venue map's block; the hold wait sits above it, Your seats below it. */
const mapBlock = () =>
  screen.getByRole('group', { name: 'Arena map' }).closest('.venue-map-layout') as HTMLElement;
const held = (n: number) => `Section A, Row 1, Seat ${n}, Standard, $40.00`;
const click = (n: number) => fireEvent.click(seat(n));
const sent = (calls: { method: string; path: string; body: unknown }[]) =>
  calls
    .filter((c) => c.method === 'POST' && c.path.startsWith('/events/e1/reservation'))
    .map((c) => {
      const s = (c.body as { seats: { seat: number }[] }).seats.map((x) => x.seat);
      return `${c.path.endsWith('/release') ? 'release' : 'hold'} ${s.join(',')}`;
    });
const yourSeats = () => screen.queryByRole('region', { name: 'Your seats' });
const heldList = () =>
  within(yourSeats()!)
    .getAllByRole('listitem')
    .map((li) => li.textContent);
const holdLog = (): HTMLElement => {
  const region = document.querySelector<HTMLElement>('[data-announces="holds"]');
  expect(region).not.toBeNull();
  return region!;
};
const logLines = () => [...holdLog().children].map((c) => c.textContent);
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

describe('a click holds the seat at once (US1-1; FR-001, FR-003, FR-010)', () => {
  it('sends one hold with that seat; the seat is yours; the Your seats box shows 5:00', async () => {
    const b = backend();
    const { calls } = withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();

    click(5);

    await waitFor(() =>
      expect(
        within(mapDrawing()).getByRole('button', { name: named(5, 'held by you') }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(calls.filter((c) => c.path === '/events/e1/reservation')).toHaveLength(1);
    expect(calls.find((c) => c.path === '/events/e1/reservation')?.body).toEqual({
      seats: [{ sectionId: 's-a', row: 1, seat: 5 }],
    });
    const box = yourSeats()!;
    const timer = within(box).getByRole('timer');
    expect(timer).toHaveClass('hold-countdown');
    expect(timer).toHaveAttribute('aria-live', 'off');
    expect(timer.querySelector('.hold-countdown__time')).toHaveTextContent('5:00');
    expect(heldList()).toEqual([held(5)]);
    expect(within(box).getByText('Total: $40.00')).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Add to cart' })).toBeEnabled();
    // The box is directly below the venue map.
    expect(mapBlock().nextElementSibling).toBe(box);
  });

  it("starts the countdown at the answer's secondsLeft and announces the hold with it", async () => {
    const b = backend({ secondsLeft: 299 });
    withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();

    click(5);

    await waitFor(() => expect(logLines()).toEqual(['Section A, Row 1, Seat 5 held. 4:59 left.']));
    expect(within(yourSeats()!).getByRole('timer')).toHaveTextContent('4:59');
    expect(holdLog()).toHaveAttribute('role', 'status');
    expect(holdLog()).toHaveAttribute('aria-atomic', 'false');
  });

  it('keeps the countdown running when a second seat joins (US1-2; FR-003)', async () => {
    fakeClock();
    const b = backend();
    withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(5);
    const box = await screen.findByRole('region', { name: 'Your seats' });
    await advance(10_000);
    expect(within(box).getByRole('timer')).toHaveTextContent('4:50');

    click(6);

    await waitFor(() => expect(heldList()).toEqual([held(5), held(6)]));
    expect(within(yourSeats()!).getByRole('timer')).toHaveTextContent('4:50');
    expect(within(yourSeats()!).getByText('Total: $80.00')).toBeInTheDocument();
    expect(logLines().at(-1)).toBe('Section A, Row 1, Seat 6 held. 4:50 left.');
  });

  it('offers no Reserve seats, Remove, Release, Release seats, Confirm purchase, or name field (FR-002)', async () => {
    const b = backend();
    withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(5);
    await screen.findByRole('region', { name: 'Your seats' });

    for (const name of [
      /^Reserve seats$/,
      /^Remove/,
      /^Release/,
      /^Release seats$/,
      /^Confirm purchase$/,
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('textbox', { name: 'Name on tickets' })).toBeNull();
  });

  it('Add to cart opens the cart and sends nothing (FR-011)', async () => {
    const b = backend();
    const { calls } = withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(5);
    await screen.findByRole('region', { name: 'Your seats' });
    const before = calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(await screen.findByRole('heading', { name: 'Cart', level: 1 })).toBeInTheDocument();
    expect(calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('a click on a held seat releases it (US2; FR-001, FR-004, FR-016)', () => {
  it('sends one release, says so, and keeps the countdown', async () => {
    fakeClock();
    const b = backend();
    const { calls } = withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(5);
    await waitFor(() => expect(b.held()).toEqual([5]));
    click(6);
    await waitFor(() => expect(heldList()).toHaveLength(2));
    await advance(20_000);

    click(6);

    await waitFor(() => expect(heldList()).toEqual([held(5)]));
    expect(sent(calls)).toEqual(['hold 5', 'hold 6', 'release 6']);
    expect(logLines().at(-1)).toBe('Section A, Row 1, Seat 6 released.');
    expect(within(yourSeats()!).getByRole('timer')).toHaveTextContent('4:40');
    expect(seat(6)).toHaveAttribute('aria-pressed', 'false');
  });

  it('the last release ends the box and says the next seat starts a new 5 minutes; the next hold restarts at 5:00', async () => {
    fakeClock();
    const b = backend();
    withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(5);
    await screen.findByRole('region', { name: 'Your seats' });
    await advance(30_000);

    click(5);

    await waitFor(() => expect(yourSeats()).toBeNull());
    expect(logLines().at(-1)).toBe(
      'Section A, Row 1, Seat 5 released. You hold no seats now; the next seat you click starts a new 5 minutes.',
    );

    click(8);
    const box = await screen.findByRole('region', { name: 'Your seats' });
    expect(within(box).getByRole('timer')).toHaveTextContent('5:00');
  });
});

describe('the click queue (FR-007; research R6)', () => {
  it('sends three quick clicks one after another, in click order', async () => {
    const b = backend({ manual: true });
    const { calls } = withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();

    click(3);
    click(1);
    click(2);
    await waitFor(() => expect(sent(calls)).toEqual(['hold 3']));
    // Pending seats are pressed, as they will be, and named holding.
    expect(within(mapDrawing()).getByRole('button', { name: named(1, 'holding') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await b.answer();
    await waitFor(() => expect(sent(calls)).toEqual(['hold 3', 'hold 1']));
    await b.answer();
    await waitFor(() => expect(sent(calls)).toEqual(['hold 3', 'hold 1', 'hold 2']));
    await b.answer();

    await waitFor(() => expect(heldList()).toHaveLength(3));
    // Three answers close together, three announcements, in order (research R10).
    expect(logLines()).toEqual([
      'Section A, Row 1, Seat 3 held. 5:00 left.',
      'Section A, Row 1, Seat 1 held. 5:00 left.',
      'Section A, Row 1, Seat 2 held. 5:00 left.',
    ]);
  });

  it('keeps at most 5 announcements and clears them 10 seconds after the last', async () => {
    fakeClock();
    const b = backend();
    withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      click(n);
      await waitFor(() => expect(b.held()).toContain(n));
    }
    await waitFor(() => expect(logLines()).toHaveLength(5));
    expect(logLines()[0]).toMatch(/^Section A, Row 1, Seat 2 held/);

    await advance(10_000);
    expect(logLines()).toEqual([]);
  });

  it('a second click on a queued, unsent hold cancels it: nothing is sent for that seat', async () => {
    const b = backend({ manual: true });
    const { calls } = withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();

    click(3);
    click(4);
    click(4);
    expect(seat(4)).toHaveAccessibleName(named(4, 'open'));
    await b.answer();

    await waitFor(() => expect(heldList()).toEqual([held(3)]));
    expect(sent(calls)).toEqual(['hold 3']);
  });

  it('a click on a seat whose hold is in flight releases it after the answer', async () => {
    const b = backend({ manual: true });
    const { calls } = withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();

    click(3);
    await waitFor(() => expect(sent(calls)).toEqual(['hold 3']));
    click(3);
    expect(
      within(mapDrawing()).getByRole('button', { name: named(3, 'releasing') }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(sent(calls)).toEqual(['hold 3']);

    await b.answer();
    await waitFor(() => expect(sent(calls)).toEqual(['hold 3', 'release 3']));
    await b.answer();

    await waitFor(() => expect(seat(3)).toHaveAccessibleName(named(3, 'open')));
    expect(yourSeats()).toBeNull();
  });

  it('drops the release queued behind a refused hold for that seat', async () => {
    let n = 0;
    const { calls } = stubApi(
      routes({
        'POST /events/e1/reservation': () => {
          n += 1;
          return refusal(
            'SEAT_TAKEN',
            'Section A, Row 1, Seat 3 is reserved by another customer.',
            { seats: [{ section: 'A', row: 1, seat: 3 }] },
          );
        },
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await openA();

    click(3);
    click(3);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Section A, Row 1, Seat 3 is reserved by another customer.',
    );
    await act(async () => undefined);
    expect(n).toBe(1);
    expect(calls.filter((c) => c.path === '/events/e1/reservation/release')).toHaveLength(0);
  });

  it('drops the hold queued behind a refused release: a double click on the only held seat leaves it held', async () => {
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': json([reservation([5])]),
        'POST /events/e1/reservation/release': refusal(
          'VALIDATION_FAILED',
          'Section A, Row 1, Seat 5 is not in your reservation.',
          undefined,
          400,
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await screen.findByRole('region', { name: 'Your seats' });
    await openA();

    click(5);
    click(5);

    expect(await screen.findByRole('alert')).toHaveTextContent('is not in your reservation');
    await act(async () => undefined);
    expect(sent(calls)).toEqual(['release 5']);
    expect(
      within(mapDrawing()).getByRole('button', { name: named(5, 'held by you') }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('drops the hold queued behind an unanswered release', async () => {
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': json([reservation([5, 6])]),
        'POST /events/e1/reservation/release': 'network-error',
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await screen.findByRole('region', { name: 'Your seats' });
    await openA();

    click(6);
    click(6);

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn.t go through/);
    await act(async () => undefined);
    expect(sent(calls)).toEqual(['release 6']);
  });
});

describe('refusals (US5; FR-006, FR-009, FR-016, FR-019)', () => {
  it('SEAT_TAKEN drops that seat, names it, and the queue goes on', async () => {
    let n = 0;
    const { calls } = stubApi(
      routes({
        'POST /events/e1/reservation': () => {
          n += 1;
          return n === 1
            ? refusal('SEAT_TAKEN', 'Section A, Row 1, Seat 3 is already taken.', {
                seats: [{ section: 'A', row: 1, seat: 3 }],
              })
            : json(reservation([4]), 201);
        },
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await openA();

    click(3);
    click(4);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Section A, Row 1, Seat 3 is already taken.',
    );
    await waitFor(() => expect(heldList()).toEqual([held(4)]));
    expect(sent(calls)).toEqual(['hold 3', 'hold 4']);
  });

  it("SEAT_COOLDOWN says when, in the viewer's zone", async () => {
    const availableAt = '2026-10-20T23:02:30.000Z';
    stubApi(
      routes({
        'POST /events/e1/reservation': refusal(
          'SEAT_COOLDOWN',
          'Your reservation of Section A, Row 1, Seat 5 ended less than 2 minutes ago.',
          { seats: [{ section: 'A', row: 1, seat: 5 }], availableAt },
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await openA();

    click(5);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Your reservation of Section A, Row 1, Seat 5 ended less than 2 minutes ago. You can hold it again at ${formatViewerTime(availableAt)}.`,
    );
    expect(seat(5)).toHaveAccessibleName(named(5, 'open'));
  });

  it('TICKET_LIMIT_REACHED keeps the held seats', async () => {
    let n = 0;
    stubApi(
      routes({
        'POST /events/e1/reservation': () => {
          n += 1;
          return n === 1
            ? json(reservation([1]), 201)
            : refusal('TICKET_LIMIT_REACHED', 'Early Show allows 1 ticket per customer.', {
                limit: 1,
                held: 0,
                remaining: 1,
                requested: 2,
              });
        },
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(1);
    await screen.findByRole('region', { name: 'Your seats' });

    click(2);

    expect(await screen.findByRole('alert')).toHaveTextContent('allows 1 ticket per customer');
    expect(heldList()).toEqual([held(1)]);
  });

  it('with 10 seats held, open seats cannot be clicked and the note says why', async () => {
    stubApi(
      routes({ 'GET /me/reservations': json([reservation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]) }),
    );
    renderCustomer({ at: '/events/e1' });
    await screen.findByRole('region', { name: 'Your seats' });
    await openA();

    // Unavailable seats stay focusable, marked aria-disabled (spec 038 FR-019).
    expect(seat(11)).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(mapDrawing()).getByRole('button', { name: named(1, 'held by you') }),
    ).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText('A reservation holds at most 10 seats.')).toBeInTheDocument();
  });

  it('a hold refused as too many tries: the wait above the map, open seats do nothing, queued holds dropped, held seats still release', async () => {
    fakeClock();
    let holds = 0;
    const { calls } = stubApi(
      routes({
        'GET /me/reservations': json([reservation([1])]),
        'POST /events/e1/reservation': () => {
          holds += 1;
          return holds === 1
            ? json(
                {
                  error: {
                    code: 'RATE_LIMITED',
                    message: 'Too many tries. You can try again in 3 seconds.',
                    details: { action: 'HOLD', retryAfterSeconds: 3 },
                  },
                },
                429,
              )
            : json(reservation([1, 4]), 200);
        },
        'POST /events/e1/reservation/release': json({ reservation: null }),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    await screen.findByRole('region', { name: 'Your seats' });
    await openA();

    click(2);
    click(3);
    // The visible countdown (aria-live off); the live region says the same words once.
    const wait = await screen.findByText(
      (_, el) =>
        el?.getAttribute('aria-live') === 'off' &&
        el.textContent === 'Too many tries. You can try again in 3 seconds.',
    );
    // Above the venue map.
    expect(wait.nextElementSibling).toBe(mapBlock());
    expect(sent(calls)).toEqual(['hold 2']);
    expect(seat(4)).toHaveAttribute('aria-disabled', 'true');
    click(4);
    expect(sent(calls)).toEqual(['hold 2']);

    // A held seat still releases.
    click(1);
    await waitFor(() => expect(sent(calls)).toEqual(['hold 2', 'release 1']));

    await advance(3_000);
    expect(screen.queryByText(/^Too many tries/)).toBeNull();
    expect(seat(4)).not.toHaveAttribute('aria-disabled');
  });

  it('a click with no answer reverts the seat, says so, and loads the map and reservation again', async () => {
    const { calls } = stubApi(routes({ 'POST /events/e1/reservation': 'network-error' }));
    renderCustomer({ at: '/events/e1' });
    await openA();
    const maps = () => calls.filter((c) => c.path === '/events/e1/venue-map').length;
    const mine = () => calls.filter((c) => c.path === '/me/reservations').length;
    const [m0, r0] = [maps(), mine()];

    click(5);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Your click on Section A, Row 1, Seat 5 didn't go through. Try again.",
    );
    await waitFor(() => expect(maps()).toBeGreaterThan(m0));
    await waitFor(() => expect(mine()).toBeGreaterThan(r0));
    expect(seat(5)).toHaveAccessibleName(named(5, 'open'));
  });
});

// Spec 038 FR-021 replaces 033 FR-005 (ticket types locked while seats are held): one hold may
// hold seats of any levels and sections of the event.
describe('seats of two levels in one hold (spec 038 FR-021)', () => {
  it('adds a seat of another section and level to the same hold, each at its own price', async () => {
    const b = backend();
    const { calls } = withBackend(b);
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(5);
    await screen.findByRole('region', { name: 'Your seats' });

    await openSection('B');
    fireEvent.click(
      within(mapDrawing()).getByRole('button', { name: 'Row 1, Seat 1, Balcony, $25, open' }),
    );

    await waitFor(() =>
      expect(heldList()).toEqual([held(5), 'Section B, Row 1, Seat 1, Balcony, $25.00']),
    );
    expect(within(yourSeats()!).getByText('Total: $65.00')).toBeInTheDocument();
    expect(within(yourSeats()!).getAllByRole('timer')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { seats: [{ sectionId: 's-a', row: 1, seat: 5 }] },
      { seats: [{ sectionId: 's-b', row: 1, seat: 1 }] },
    ]);
  });
});

describe('the countdown (FR-010, FR-015)', () => {
  it('warns once at 1 minute, in its own status region', async () => {
    fakeClock();
    withBackend(backend());
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(5);
    const timer = within(await screen.findByRole('region', { name: 'Your seats' })).getByRole(
      'timer',
    );

    await advance(239_000);
    expect(timer).toHaveTextContent('1:01');
    expect(screen.queryByText('1 minute left to buy your seats.')).toBeNull();
    await advance(1_000);
    const warning = screen.getByText('1 minute left to buy your seats.');
    expect(warning.closest('[role="status"]')).not.toBeNull();
    await advance(10_000);
    expect(screen.getAllByText('1 minute left to buy your seats.')).toHaveLength(1);
  });

  it('at 0:00 drops the box and says the reservation ran out', async () => {
    fakeClock();
    withBackend(backend());
    renderCustomer({ at: '/events/e1' });
    await openA();
    click(5);
    await screen.findByRole('region', { name: 'Your seats' });

    await advance(300_000);

    expect(yourSeats()).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your reservation ran out, so its seats were released. You can hold them again in 2 minutes if they are still open.',
    );
  });
});
