import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { json, seatStream, stubApi } from './helpers/api-stub';
import { EVENT } from './fixtures-005';
import { arenaVenueMap } from './fixtures-038';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 015 (FR-010, FR-012, FR-013; research R14): the Admin app's event seat map shows held seats
 * and counts, and updates live. Spec 038 US6 (T048): on the shared venue map, by seat state.
 */
afterEach(() => vi.unstubAllGlobals());

const PATH = `/events/${EVENT.id}`;
const SEATED = { ...EVENT, reservedSeating: true, layoutId: 'l-arena', priceMax: '90.00' };
type States = Record<string, 'reserved' | 'sold' | 'offSale'>;

const AVAILABILITY = {
  eventId: EVENT.id,
  ticketsLeft: EVENT.totalTicketCapacity,
  salesClosed: null,
  tiers: [],
};

function setup(
  states: States = {},
  availability: Response | (() => Promise<Response>) = json(AVAILABILITY),
) {
  const stream = seatStream();
  stubApi({
    [`GET ${PATH}`]: json(SEATED),
    [`GET ${PATH}/tiers`]: json([]),
    ...arenaVenueMap(EVENT.id, { states }).routes,
    [`GET ${PATH}/seats/stream`]: stream.reply,
    [`GET ${PATH}/availability`]: availability,
  });
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  return stream;
}

const drawing = () => screen.getByRole('group', { name: 'Arena map' });
const floorA = () => within(drawing()).getByRole('button', { name: /^Section Floor A,/ });
const seat = (row: number, s: number, state: string) =>
  within(drawing()).getByRole('button', { name: `Row ${row}, Seat ${s}, Front, $90, ${state}` });
const change = (seq: number, ...seats: [number, number, string, string][]) => ({
  eventId: EVENT.id,
  seq,
  changes: seats.map(([row, s, state, from]) => ({
    sectionId: 's-a',
    row,
    seat: s,
    state,
    from,
    levelId: 'l-front',
  })),
});

describe('the live Admin seat map (FR-010)', () => {
  it('updates the seats and the counts on a seated event, without a refresh', async () => {
    const stream = setup();
    const card = await screen.findByRole('region', { name: 'Seating' });
    await within(card).findByText(/^0 sold/);
    fireEvent.click(await within(card).findByRole('button', { name: /^Section Floor A,/ }));
    await within(drawing()).findByRole('button', { name: /^Row 1, Seat 3,/ });

    await waitFor(() => stream.send('venueMap', arenaVenueMap(EVENT.id).map));
    act(() => stream.send('seats', change(2, [1, 3, 'sold', 'open'], [1, 4, 'sold', 'open'])));

    expect(await within(card).findByText(/^2 sold/)).toBeInTheDocument();
    await waitFor(() => expect(seat(1, 3, 'sold')).toBeInTheDocument());
    expect(seat(1, 3, 'sold').querySelector('.venue-map__mark--cross')).not.toBeNull();
    expect(seat(1, 4, 'sold')).toBeInTheDocument();
  });
});

describe('held seats on the Admin seat map (US4; FR-012, FR-013)', () => {
  it('marks a held seat hollow and names it held, apart from sold and open', async () => {
    setup({ 's-a/1/1': 'sold', 's-a/1/2': 'reserved' });
    const card = await screen.findByRole('region', { name: 'Seating' });
    fireEvent.click(await within(card).findByRole('button', { name: /^Section Floor A,/ }));

    const held = await within(drawing()).findByRole('button', {
      name: 'Row 1, Seat 2, Front, $90, held',
    });
    expect(held).toHaveClass('venue-map__seat--held');
    expect(held.querySelector('.venue-map__dot--hollow')).not.toBeNull();
    expect(seat(1, 1, 'sold')).toHaveClass('venue-map__seat--sold');
    expect(seat(1, 3, 'open')).toHaveClass('venue-map__seat--open');
  });

  it("shows each section's sold, held, and open counts, and keeps them current", async () => {
    const states = { 's-a/1/1': 'sold', 's-a/1/2': 'reserved' } as const;
    const stream = setup(states);
    const card = await screen.findByRole('region', { name: 'Seating' });
    await within(card).findByRole('group', { name: 'Arena map' });
    expect(floorA()).toHaveAccessibleName('Section Floor A, 28 open, 1 held, 1 sold, 0 off sale');

    await waitFor(() => stream.send('venueMap', arenaVenueMap(EVENT.id, { states }).map));
    act(() =>
      stream.send('seats', change(2, [2, 1, 'reserved', 'open'], [2, 2, 'reserved', 'open'])),
    );
    await waitFor(() =>
      expect(floorA()).toHaveAccessibleName('Section Floor A, 26 open, 3 held, 1 sold, 0 off sale'),
    );
    expect(within(drawing()).getByText('1 / 26')).toBeInTheDocument();
  });
});

describe('review round 1 (T047)', () => {
  it('keeps a change that arrives before the rest of the card has loaded', async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const stream = setup({}, async () => {
      await slow;
      return json(AVAILABILITY);
    });
    await waitFor(() => stream.send('venueMap', arenaVenueMap(EVENT.id).map));
    act(() => stream.send('seats', change(2, [1, 1, 'sold', 'open'])));

    await act(async () => release());

    const card = await screen.findByRole('region', { name: 'Seating' });
    await waitFor(() =>
      expect(floorA()).toHaveAccessibleName('Section Floor A, 29 open, 0 held, 1 sold, 0 off sale'),
    );
    expect(within(card).getByText('1 sold, 0 held, 69 open, 0 off sale')).toBeInTheDocument();
  });
});
