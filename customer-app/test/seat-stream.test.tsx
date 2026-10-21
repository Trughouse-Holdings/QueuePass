import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Reservation, SeatMap } from '@queuepass/shared';
import { availability, event, json, renderCustomer, seatStream, stubApi, tier } from './helpers';

/**
 * Spec 015 US3 (FR-010–FR-012; research R9, R13): the Customer app's seat map is live. Another
 * customer's reservation greys out without a refresh, a pick someone else takes is dropped with a
 * message, and a focused seat that becomes unavailable keeps focus.
 */
afterEach(() => vi.unstubAllGlobals());

const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00', quantity: 30 });

const seatMap = (): SeatMap => ({
  eventId: 'e1',
  reservedSeating: true,
  sections: [
    {
      sectionId: 's-a',
      name: 'A',
      rows: 1,
      seatsPerRow: 6,
      tierId: 't-vip',
      sold: 0,
      taken: [],
      reserved: [],
    },
  ],
});

const changes = (...seats: [number, 'open' | 'reserved' | 'sold'][]) => ({
  eventId: 'e1',
  changes: seats.map(([seat, state]) => ({ sectionId: 's-a', row: 1, seat, state })),
});

const reservation = (seats: number[]): Reservation => ({
  eventId: 'e1',
  tierId: 't-vip',
  seats: seats.map((seat) => ({ sectionId: 's-a', section: 'A', row: 1, seat })),
  createdAt: '2026-10-20T19:00:00.000Z',
  expiresAt: '2026-10-20T19:05:00.000Z',
  secondsLeft: 300,
});

function setup(extra: Record<string, Response | (() => Response)> = {}) {
  const stream = seatStream();
  const api = stubApi({
    'GET /events/e1': json(event({ reservedSeating: true })),
    'GET /events/e1/tiers': json([vip]),
    'GET /events/e1/availability': json(
      availability({ ticketsLeft: 6, tiers: [{ tierId: 't-vip', ticketsLeft: 6 }] }),
    ),
    'GET /events/e1/seats': json(seatMap()),
    'GET /events/e1/seats/stream': stream.reply,
    'GET /me/reservations': json([]),
    ...extra,
  });
  renderCustomer({ at: '/events/e1' });
  return { stream, ...api };
}

const seatButton = (seat: number) =>
  screen.getByRole('button', { name: new RegExp(`^Row 1, Seat ${seat}(,|$)`) });
const picks = () =>
  within(screen.getByRole('list', { name: 'Chosen seats' }))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);
/** Waits for the stream to be open, then sends its snapshot. */
async function live(stream: ReturnType<typeof seatStream>): Promise<void> {
  fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
  await waitFor(() => expect(stream.connects).toBe(1));
  act(() => stream.send('snapshot', seatMap()));
}

describe('live seat map (US3; FR-010)', () => {
  it("greys out another customer's reservation without a refresh", async () => {
    const { stream } = setup();
    await live(stream);
    expect(seatButton(4)).not.toHaveAttribute('aria-disabled', 'true');

    act(() => stream.send('seats', changes([4, 'reserved'])));

    await waitFor(() => expect(seatButton(4)).toHaveAttribute('aria-disabled', 'true'));
    act(() => stream.send('seats', changes([4, 'open'])));
    await waitFor(() => expect(seatButton(4)).not.toHaveAttribute('aria-disabled', 'true'));
  });

  it('drops a pick another customer reserves or buys, naming it in a status region (FR-011)', async () => {
    const { stream } = setup();
    await live(stream);
    fireEvent.click(seatButton(2));
    fireEvent.click(seatButton(3));
    fireEvent.click(seatButton(5));

    act(() => stream.send('seats', changes([3, 'reserved'], [5, 'sold'])));

    await waitFor(() => expect(picks()).toEqual(['Section A, Row 1, Seat 2']));
    const message = screen.getByText(/Section A, Row 1, Seat 3.*no longer available/);
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(message).toHaveTextContent('Section A, Row 1, Seat 5');
  });

  it('keeps focus on a focused seat that becomes unavailable, and ignores activating it (FR-012)', async () => {
    const { stream, calls } = setup();
    await live(stream);
    seatButton(6).focus();
    expect(seatButton(6)).toHaveFocus();

    act(() => stream.send('seats', changes([6, 'sold'])));

    await waitFor(() => expect(seatButton(6)).toHaveAttribute('aria-disabled', 'true'));
    expect(seatButton(6)).toHaveFocus();
    expect(seatButton(6)).not.toBeDisabled();
    fireEvent.click(seatButton(6));
    expect(picks()).toEqual([]);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it("reloads My reservations when a change touches the customer's own reserved seat", async () => {
    let lists = 0;
    const { stream } = setup({
      'GET /me/reservations': () => json(lists++ === 0 ? [reservation([2, 3])] : []),
    });
    await screen.findByRole('timer');
    await waitFor(() => expect(stream.connects).toBe(1));
    act(() => stream.send('snapshot', seatMap()));

    // An admin change ended it: both seats are open again.
    act(() => stream.send('seats', changes([2, 'open'], [3, 'open'])));

    await waitFor(() => expect(lists).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByRole('timer')).toBeNull());
  });

  it('shows a reservation made in another tab', async () => {
    let lists = 0;
    const { stream } = setup({
      'GET /me/reservations': () => json(lists++ === 0 ? [] : [reservation([4])]),
    });
    await live(stream);

    act(() => stream.send('seats', changes([4, 'reserved'])));

    expect(await screen.findByRole('timer')).toBeInTheDocument();
    expect(seatButton(4)).toHaveAttribute('aria-pressed', 'true');
  });

  it('drops a pick a reconnect snapshot shows as taken, naming it (FR-011, T047)', async () => {
    const { stream } = setup();
    await live(stream);
    fireEvent.click(seatButton(2));
    fireEvent.click(seatButton(3));

    const later = seatMap();
    later.sections[0].reserved = [{ row: 1, seat: 3 }];
    act(() => stream.send('snapshot', later));

    await waitFor(() => expect(picks()).toEqual(['Section A, Row 1, Seat 2']));
    expect(screen.getByText(/Section A, Row 1, Seat 3.*no longer available/)).toBeInTheDocument();
    // It was open before, so it stays focusable (FR-012, review round 2).
    expect(seatButton(3)).toHaveAttribute('aria-disabled', 'true');
    expect(seatButton(3)).not.toBeDisabled();
  });

  it('loads the tiers again when a snapshot maps the sections to other tiers (FR-016, T046)', async () => {
    const gen = tier({ id: 't-gen', name: 'General', price: '20.00', quantity: 6 });
    let remapped = false;
    let tierLoads = 0;
    const { stream } = setup({
      'GET /events/e1/tiers': () => {
        tierLoads += 1;
        return json(remapped ? [vip, gen] : [vip]);
      },
      'GET /events/e1/availability': () =>
        json(
          availability({
            ticketsLeft: 6,
            tiers: remapped
              ? [
                  { tierId: 't-vip', ticketsLeft: 0 },
                  { tierId: 't-gen', ticketsLeft: 6 },
                ]
              : [{ tierId: 't-vip', ticketsLeft: 6 }],
          }),
        ),
    });
    await live(stream);
    // A reconnect with the same mapping loads nothing again.
    act(() => stream.send('snapshot', seatMap()));
    expect(tierLoads).toBe(1);

    remapped = true;
    const later = seatMap();
    later.sections[0].tierId = 't-gen';
    act(() => stream.send('snapshot', later));

    expect(await screen.findByRole('radio', { name: 'General, $20.00, 6 left' })).toBeEnabled();
    expect(tierLoads).toBe(2);
  });

  it("never calls the customer's own reserved seats taken by someone else (review round 2)", async () => {
    const { stream } = setup({ 'GET /me/reservations': json([reservation([2, 3])]) });
    await screen.findByRole('timer');
    await waitFor(() => expect(stream.connects).toBe(1));
    const mine = seatMap();
    mine.sections[0].reserved = [
      { row: 1, seat: 2 },
      { row: 1, seat: 3 },
    ];

    act(() => stream.send('snapshot', mine));

    expect(seatButton(2)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/no longer available/)).toBeNull();
  });
});
