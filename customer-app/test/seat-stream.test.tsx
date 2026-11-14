import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Reservation } from '@queuepass/shared';
import {
  availability,
  event,
  json,
  openSection,
  renderCustomer,
  seatOf,
  seatStream,
  seatedMap,
  stubApi,
  fixTimeBeforeFixtures,
  type SectionFixture,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 015 US3 (FR-010–FR-012; research R9, R13): the Customer app's seat map is live. Another
 * customer's reservation greys out without a refresh, a pick someone else takes is dropped with a
 * message, and a focused seat that becomes unavailable keeps focus. Spec 038 (research R12): the
 * stream begins with the venue map; each change carries its `seq`, `from` and level.
 */
afterEach(() => vi.unstubAllGlobals());

type State = 'open' | 'reserved' | 'sold' | 'offSale';
/** Section A, one row of 6 seats at $40; `over` sets seats' states. */
const sectionA = (over: Partial<SectionFixture> = {}): SectionFixture => ({
  sectionId: 's-a',
  name: 'A',
  rows: 1,
  seatsPerRow: 6,
  ...over,
});

let seq = 1;
/** Seats of row 1 of section A that changed, with the next `seq`. */
const changes = (...seats: [number, State, State?][]) => ({
  eventId: 'e1',
  seq: ++seq,
  changes: seats.map(([seat, state, from]) => ({
    sectionId: 's-a',
    row: 1,
    seat,
    state,
    from: from ?? (state === 'open' ? 'reserved' : 'open'),
    levelId: 'l-std',
  })),
});

const reservation = (seats: number[]): Reservation =>
  ({
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
  }) as Reservation;

type Reply = Response | ((req: Request) => Response | Promise<Response>);
/** The map's state as the Backend has it now; the routes read it at each request. */
function setup(extra: Record<string, Reply> = {}, start: Partial<SectionFixture> = {}) {
  seq = 1;
  const stream = seatStream();
  const now = { fixture: sectionA(start), seq: 1 };
  const current = () => seatedMap([now.fixture], { seq: now.seq });
  const api = stubApi({
    'GET /events/e1': json(event({ reservedSeating: true, layoutId: 'lay-1', basePrice: '40.00' })),
    'GET /events/e1/tiers': json([]),
    'GET /events/e1/availability': json(availability({ ticketsLeft: 6 })),
    'GET /events/e1/venue-map': () => json(current().map),
    'GET /events/e1/venue-map/sections/s-a': () => json(current().section('s-a')),
    'GET /events/e1/seats/stream': stream.reply,
    'GET /me/reservations': json([]),
    ...extra,
  });
  renderCustomer({ at: '/events/e1' });
  /** The map as it is now, and as the stream sends it first. */
  const map = () => current().map;
  return { stream, now, map, ...api };
}

/** Opens section A, waits for the stream, then sends its venue map. */
async function live(s: ReturnType<typeof setup>): Promise<void> {
  await openSection('A');
  await waitFor(() => expect(s.stream.connects).toBe(1));
  act(() => s.stream.send('venueMap', s.map()));
}

describe('live seat map (US3; FR-010)', () => {
  it("greys out another customer's reservation without a refresh", async () => {
    const s = setup();
    await live(s);
    expect(seatOf(1, 4)).not.toHaveAttribute('aria-disabled', 'true');

    act(() => s.stream.send('seats', changes([4, 'reserved'])));

    await waitFor(() => expect(seatOf(1, 4)).toHaveAttribute('aria-disabled', 'true'));
    act(() => s.stream.send('seats', changes([4, 'open'])));
    await waitFor(() => expect(seatOf(1, 4)).not.toHaveAttribute('aria-disabled', 'true'));
  });

  it('marks seats another customer reserves or buys while shown, and sends nothing for them (FR-011; spec 033 research R10)', async () => {
    const s = setup();
    await live(s);

    act(() => s.stream.send('seats', changes([3, 'reserved'], [5, 'sold'])));

    await waitFor(() => expect(seatOf(1, 3)).toHaveAttribute('aria-disabled', 'true'));
    expect(seatOf(1, 5)).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(seatOf(1, 3));
    fireEvent.click(seatOf(1, 5));
    expect(s.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('keeps focus on a focused seat that becomes unavailable, and ignores activating it (FR-012)', async () => {
    const s = setup();
    await live(s);
    seatOf(1, 6).focus();
    expect(seatOf(1, 6)).toHaveFocus();

    act(() => s.stream.send('seats', changes([6, 'sold'])));

    await waitFor(() => expect(seatOf(1, 6)).toHaveAttribute('aria-disabled', 'true'));
    expect(seatOf(1, 6)).toHaveFocus();
    fireEvent.click(seatOf(1, 6));
    expect(s.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it("reloads My reservations when a change touches the customer's own reserved seat", async () => {
    let lists = 0;
    const s = setup(
      { 'GET /me/reservations': () => json(lists++ === 0 ? [reservation([2, 3])] : []) },
      {
        reserved: [
          [1, 2],
          [1, 3],
        ],
      },
    );
    await screen.findByRole('timer');
    await waitFor(() => expect(s.stream.connects).toBe(1));
    act(() => s.stream.send('venueMap', s.map()));

    // An admin change ended it: both seats are open again.
    act(() => s.stream.send('seats', changes([2, 'open'], [3, 'open'])));

    await waitFor(() => expect(lists).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByRole('timer')).toBeNull());
  });

  it('shows a reservation made in another tab', async () => {
    let lists = 0;
    const s = setup({
      'GET /me/reservations': () => json(lists++ === 0 ? [] : [reservation([4])]),
    });
    await live(s);

    act(() => s.stream.send('seats', changes([4, 'reserved'])));

    expect(await screen.findByRole('timer')).toBeInTheDocument();
    expect(seatOf(1, 4)).toHaveAttribute('aria-pressed', 'true');
  });

  it("keeps focus on a seat another customer took while this customer's hold of it was pending (spec 033 review M1)", async () => {
    let answer: (r: Response) => void = () => undefined;
    const s = setup({
      'POST /events/e1/reservation': () => new Promise<Response>((r) => (answer = r)),
    });
    await live(s);
    const seat = seatOf(1, 4);
    seat.focus();
    fireEvent.click(seat);
    await waitFor(() =>
      expect(seatOf(1, 4)).toHaveAccessibleName('Row 1, Seat 4, Standard, $40, holding'),
    );

    // Another customer's hold of it arrives while this one is in flight.
    act(() => s.stream.send('seats', changes([4, 'reserved'])));
    await act(async () =>
      answer(
        json(
          {
            error: {
              code: 'SEAT_TAKEN',
              message: 'Section A, Row 1, Seat 4 is reserved by another customer.',
              details: { seats: [{ section: 'A', row: 1, seat: 4 }] },
            },
          },
          409,
        ),
      ),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Seat 4 is reserved');
    await waitFor(() =>
      expect(seatOf(1, 4)).toHaveAccessibleName('Row 1, Seat 4, Standard, $40, held'),
    );
    expect(seatOf(1, 4)).toHaveAttribute('aria-disabled', 'true');
    expect(seatOf(1, 4)).toHaveFocus();
  });

  it('keeps a change the stream sent while a read of the map was in flight (review round 3, S1; spec 038 R12)', async () => {
    let reads = 0;
    let answer: (r: Response) => void = () => undefined;
    const older = seatedMap([sectionA()]).map;
    const s = setup({
      'GET /events/e1/venue-map': () =>
        reads++ === 0 ? json(older) : new Promise<Response>((r) => (answer = r)),
      'POST /events/e1/reservation': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await live(s);

    // No answer to a hold: the map is read again.
    fireEvent.click(seatOf(1, 2));
    expect(await screen.findByRole('alert')).toHaveTextContent(/didn.t go through/);
    await waitFor(() => expect(reads).toBe(2));

    // The stream says seat 5 is now held, then the older read answers with it open.
    act(() => s.stream.send('seats', changes([5, 'reserved'])));
    await waitFor(() => expect(seatOf(1, 5)).toHaveAttribute('aria-disabled', 'true'));
    await act(async () => answer(json(older)));

    // The section is read again after that map, and the change is kept on it (by its seq).
    await waitFor(() =>
      expect(s.calls.filter((c) => c.path === '/events/e1/venue-map/sections/s-a').length).toBe(3),
    );
    await waitFor(() =>
      expect(seatOf(1, 5)).toHaveAccessibleName('Row 1, Seat 5, Standard, $40, held'),
    );
    expect(seatOf(1, 5)).toHaveAttribute('aria-disabled', 'true');
  });

  it('marks a seat a reconnect map shows as taken, reading the open section again (FR-011, T047)', async () => {
    const s = setup();
    await live(s);
    const reads = () =>
      s.calls.filter((c) => c.path === '/events/e1/venue-map/sections/s-a').length;
    const before = reads();

    s.now.fixture = sectionA({ reserved: [[1, 3]] });
    s.now.seq = 9;
    act(() => s.stream.send('venueMap', s.map()));

    // It stays focusable, marked aria-disabled (FR-012, review round 2).
    await waitFor(() => expect(seatOf(1, 3)).toHaveAttribute('aria-disabled', 'true'));
    expect(reads()).toBe(before + 1);
    fireEvent.click(seatOf(1, 3));
    expect(s.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  // Spec 038 R12: replaces 015's tier remapping. A layout or price change ends the stream; the map
  // after the reconnect has the new prices, and what is left is read again.
  it('reads what is left again, and shows the new prices, after a later venue map', async () => {
    let loads = 0;
    const s = setup({
      'GET /events/e1/availability': () => {
        loads += 1;
        return json(availability({ ticketsLeft: 6 }));
      },
    });
    await live(s);
    expect(screen.getByText('Standard $40')).toBeInTheDocument();
    const first = loads;

    const repriced = s.map();
    repriced.levels = [{ ...repriced.levels[0], price: '45.00' }];
    repriced.seq = 5;
    act(() => s.stream.send('venueMap', repriced));

    expect(await screen.findByText('Standard $45')).toBeInTheDocument();
    await waitFor(() => expect(loads).toBe(first + 1));
  });

  it("never calls the customer's own reserved seats taken by someone else (review round 2)", async () => {
    const s = setup(
      { 'GET /me/reservations': json([reservation([2, 3])]) },
      {
        reserved: [
          [1, 2],
          [1, 3],
        ],
      },
    );
    await screen.findByRole('timer');
    await openSection('A');
    await waitFor(() => expect(s.stream.connects).toBe(1));

    act(() => s.stream.send('venueMap', s.map()));

    await waitFor(() =>
      expect(seatOf(1, 2)).toHaveAccessibleName('Row 1, Seat 2, Standard, $40, held by you'),
    );
    expect(seatOf(1, 2)).toHaveAttribute('aria-pressed', 'true');
    expect(seatOf(1, 3)).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(/no longer available/)).toBeNull();
  });
});
