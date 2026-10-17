import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { json, seatStream, stubApi } from './helpers/api-stub';
import { EVENT } from './fixtures-005';

/**
 * Spec 015 (FR-010, FR-012, FR-013; research R14): the Admin app's event seat map shows reserved
 * seats and counts, and updates live.
 */
afterEach(() => vi.unstubAllGlobals());

const PATH = `/events/${EVENT.id}`;
const VIP = {
  id: 't-vip',
  eventId: EVENT.id,
  name: 'VIP',
  price: '120.00',
  quantity: 30,
  createdAt: EVENT.createdAt,
  updatedAt: EVENT.updatedAt,
};

const map = (over: { taken?: object[]; reserved?: object[] } = {}) => ({
  eventId: EVENT.id,
  reservedSeating: true,
  sections: [
    {
      sectionId: 's-a',
      name: 'A',
      rows: 3,
      seatsPerRow: 10,
      tierId: 't-vip',
      sold: over.taken?.length ?? 0,
      taken: over.taken ?? [],
      reserved: over.reserved ?? [],
    },
  ],
});

function setup(seatMap = map()) {
  const stream = seatStream();
  stubApi({
    [`GET ${PATH}`]: json({ ...EVENT, reservedSeating: true }),
    [`GET ${PATH}/tiers`]: json([VIP]),
    [`GET ${PATH}/seats`]: json(seatMap),
    [`GET ${PATH}/seats/stream`]: stream.reply,
    [`GET ${PATH}/availability`]: json({
      eventId: EVENT.id,
      ticketsLeft: EVENT.totalTicketCapacity,
      salesClosed: null,
      tiers: [],
    }),
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

const seat = (row: number, s: number, state: string) =>
  screen.getByRole('img', { name: `Row ${row}, Seat ${s}, ${state}` });

describe('the live Admin seat map (FR-010)', () => {
  it('updates the seats and the counts on a seats event, without a refresh', async () => {
    const stream = setup();
    const card = await screen.findByRole('region', { name: 'Seating' });
    await within(card).findByText(/^0 sold/);

    await waitFor(() => stream.send('snapshot', map()));
    act(() =>
      stream.send('seats', {
        eventId: EVENT.id,
        changes: [
          { sectionId: 's-a', row: 1, seat: 3, state: 'sold' },
          { sectionId: 's-a', row: 1, seat: 4, state: 'sold' },
        ],
      }),
    );

    expect(await within(card).findByText(/^2 sold/)).toBeInTheDocument();
    expect(seat(1, 3, 'sold')).toHaveTextContent('■');
    expect(seat(1, 4, 'sold')).toBeInTheDocument();
  });
});

describe('reserved seats on the Admin seat map (US4; FR-012, FR-013)', () => {
  it('marks a reserved seat ◩ and names it reserved, apart from sold and open', async () => {
    setup(map({ taken: [{ row: 1, seat: 1 }], reserved: [{ row: 1, seat: 2 }] }));
    await screen.findByRole('region', { name: 'Seating' });

    expect(await screen.findByRole('img', { name: 'Row 1, Seat 2, reserved' })).toHaveTextContent(
      '◩',
    );
    expect(seat(1, 1, 'sold')).toHaveTextContent('■');
    expect(seat(1, 3, 'open')).toHaveTextContent('□');
  });

  it("shows each section's sold, reserved, and open counts, and keeps them current", async () => {
    const stream = setup(map({ taken: [{ row: 1, seat: 1 }], reserved: [{ row: 1, seat: 2 }] }));
    const card = await screen.findByRole('region', { name: 'Seating' });

    expect(await within(card).findByText('1 sold, 1 reserved, 28 open')).toBeInTheDocument();

    await waitFor(() =>
      stream.send(
        'snapshot',
        map({ taken: [{ row: 1, seat: 1 }], reserved: [{ row: 1, seat: 2 }] }),
      ),
    );
    act(() =>
      stream.send('seats', {
        eventId: EVENT.id,
        changes: [
          { sectionId: 's-a', row: 2, seat: 1, state: 'reserved' },
          { sectionId: 's-a', row: 2, seat: 2, state: 'reserved' },
        ],
      }),
    );
    expect(await within(card).findByText('1 sold, 3 reserved, 26 open')).toBeInTheDocument();
  });
});
