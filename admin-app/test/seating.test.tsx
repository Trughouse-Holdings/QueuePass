import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { json, stubApi } from './helpers/api-stub';
import { EVENT } from './fixtures-005';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 007 US4 (FR-012): the event page's Seating card and seat map. Spec 038 US2: seating is set in
 * the event form; the seat map is US6's (T048, T049).
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
const GEN = { ...VIP, id: 't-gen', name: 'General', price: '40.00', quantity: 40 };

const map = (reservedSeating: boolean, sold = 0) => ({
  eventId: EVENT.id,
  reservedSeating,
  sections: [
    {
      sectionId: 's-a',
      name: 'A',
      rows: 3,
      seatsPerRow: 10,
      tierId: reservedSeating ? 't-vip' : null,
      sold,
      taken: Array.from({ length: sold }, (_, i) => ({ row: 1, seat: i + 1 })),
      reserved: [],
    },
    {
      sectionId: 's-b',
      name: 'B',
      rows: 2,
      seatsPerRow: 20,
      tierId: null,
      sold: 0,
      taken: [],
      reserved: [],
    },
  ],
});

const routes = (opts: { seatMap?: object; ticketsLeft?: number; extra?: object } = {}) => ({
  [`GET ${PATH}`]: json(EVENT),
  [`GET ${PATH}/tiers`]: json([GEN, VIP]),
  [`GET ${PATH}/seats`]: json(opts.seatMap ?? map(false)),
  [`GET ${PATH}/availability`]: json({
    eventId: EVENT.id,
    ticketsLeft: opts.ticketsLeft ?? EVENT.totalTicketCapacity,
    salesClosed: null,
    tiers: [],
  }),
  ...(opts.extra ?? {}),
});

/** Spec 038: a seated event is one with a layout. */
const SEATED = { ...EVENT, reservedSeating: true, layoutId: 'l-arena', priceMax: '95.00' };

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );

const card = () => screen.findByRole('region', { name: 'Seating' });

describe('Seating card', () => {
  // Spec 038 (FR-015, research R15): the layout, prices and seats off sale are set in the event
  // form; the card says which the event is and where to change it, and never writes.
  it('says a general-admission event is one, with no seat map and no switch', async () => {
    const api = stubApi(routes());
    renderPage();

    const region = await card();
    expect(await within(region).findByText('General admission.')).toBeInTheDocument();
    expect(within(region).queryByRole('checkbox')).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Save seating' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Seat map' })).toBeNull();
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it("points a seated event's seating to Edit event, with no section-to-tier mapping", async () => {
    stubApi({ ...routes({ seatMap: map(true) }), [`GET ${PATH}`]: json(SEATED) });
    renderPage();

    const region = await card();
    expect(within(region).getByRole('link', { name: 'Edit event' })).toHaveAttribute(
      'href',
      `${PATH}/edit`,
    );
    expect(within(region).queryByRole('combobox', { name: 'Section A tier' })).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Save seating' })).toBeNull();
  });
});

describe('Seat map', () => {
  it('shows one section at a time, each seat sold or open, with counts', async () => {
    stubApi({
      ...routes({ seatMap: map(true, 2), ticketsLeft: EVENT.totalTicketCapacity - 2 }),
      [`GET ${PATH}`]: json(SEATED),
    });
    renderPage();

    const region = await card();
    expect(await within(region).findByText('2 sold, 0 reserved, 28 open')).toBeInTheDocument();
    const grid = within(region).getByRole('group', { name: 'Section A seat map' });
    expect(within(grid).getByLabelText('Row 1, Seat 1, sold')).toBeInTheDocument();
    expect(within(grid).getByLabelText('Row 1, Seat 3, open')).toBeInTheDocument();
    expect(within(grid).getAllByLabelText(/^Row \d+, Seat \d+, (sold|open)$/)).toHaveLength(30);

    fireEvent.change(within(region).getByRole('combobox', { name: 'Seat map section' }), {
      target: { value: 's-b' },
    });
    expect(within(region).getByText('0 sold, 0 reserved, 40 open')).toBeInTheDocument();
    expect(within(region).getByRole('group', { name: 'Section B seat map' })).toBeInTheDocument();
  });
});
