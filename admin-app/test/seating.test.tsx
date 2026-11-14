import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { json, stubApi } from './helpers/api-stub';
import { EVENT } from './fixtures-005';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 007 US4 (FR-012): the event page's Seating card. Spec 038 US2: seating is set in the event
 * form; the card's live map by seat state is US6's (`event-seat-map.test.tsx`, T048).
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

const routes = (opts: { ticketsLeft?: number; extra?: object } = {}) => ({
  [`GET ${PATH}`]: json(EVENT),
  [`GET ${PATH}/tiers`]: json([GEN, VIP]),
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
    stubApi({ ...routes(), [`GET ${PATH}`]: json(SEATED) });
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
