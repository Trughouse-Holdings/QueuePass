import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Attendees } from '../src/pages/Attendees';
import { when } from '../src/format';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, ORDERS } from './fixtures-005';

/** Spec 005 US3 (FR-007): an event's attendee list. */
afterEach(() => vi.unstubAllGlobals());

const PATH = `/events/${EVENT.id}/attendees`;
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id/attendees" element={<Attendees />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Attendees page', () => {
  it('lists each order with its customer, tier, amount, status, ticket codes, and check-ins', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Attendees: Season Opener' }),
    ).toBeInTheDocument();
    const first = screen.getByText('customer3').closest('tr') as HTMLElement;
    expect(within(first).getByText('VIP')).toBeInTheDocument();
    expect(within(first).getByText('$168.60')).toBeInTheDocument();
    expect(within(first).getByText('Confirmed')).toBeInTheDocument();
    expect(within(first).getByText(/ABCDEFGH2345/)).toBeInTheDocument();
    expect(within(first).getByText(/JKLMNPQR6789/)).toBeInTheDocument();
    expect(within(first).getByText('1 of 2 checked in')).toBeInTheDocument();

    const second = screen.getByText('customer1').closest('tr') as HTMLElement;
    expect(within(second).getByText('Refunded')).toBeInTheDocument();
  });

  it('summarizes orders, valid tickets, and check-ins', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();
    expect(
      await screen.findByText('2 orders · 2 valid tickets · 1 checked in'),
    ).toBeInTheDocument();
  });

  it('says when no one has tickets yet', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([]) });
    renderPage();
    expect(await screen.findByText('No one has tickets for this event yet.')).toBeInTheDocument();
  });

  it('links back to the event', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([]) });
    renderPage();
    expect(await screen.findByRole('link', { name: 'Back to Season Opener' })).toHaveAttribute(
      'href',
      `/events/${EVENT.id}`,
    );
  });

  it('shows the seat of each seated ticket (spec 007 FR-011)', async () => {
    const seated = [
      {
        ...ORDERS[0],
        tickets: ORDERS[0].tickets.map((t, i) => ({
          ...t,
          seat: i === 0 ? { section: 'A', row: 1, seat: 5, rowLabel: 'A', seatLabel: '5' } : null,
        })),
      },
    ];
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(seated) });
    renderPage();

    const row = (await screen.findByText('customer3')).closest('tr') as HTMLElement;
    const items = within(row)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    // Spec 038 FR-026: the row and seat by their labels as sold.
    expect(items[0]).toContain('Section A, Row A, Seat 5');
    expect(items.slice(1).join(' ')).not.toContain('Section');
  });
});

describe('names and entry times (spec 017 FR-004, FR-005, FR-020)', () => {
  it('shows a Name on tickets column, with "No name on ticket" for an order without one', async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();

    expect(
      await screen.findByRole('columnheader', { name: 'Name on tickets' }),
    ).toBeInTheDocument();
    const first = screen.getByText('customer3').closest('tr') as HTMLElement;
    expect(within(first).getByText('Jordan Lee')).toBeInTheDocument();
    const second = screen.getByText('customer1').closest('tr') as HTMLElement;
    expect(within(second).getByText('No name on ticket')).toBeInTheDocument();
  });

  it("shows each checked-in ticket's time of entry", async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();

    const first = (await screen.findByText('customer3')).closest('tr') as HTMLElement;
    const items = within(first)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items[0]).toContain(`checked in ${when('2026-11-01T22:45:00.000Z')}`);
    expect(items[1]).not.toContain('checked in');
  });
});

/** Spec 038 FR-030 (research R17): a seated order names each ticket's price level and price. */
const SEATED = {
  ...ORDERS[0],
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  tierId: null,
  tierName: null,
  customerUsername: 'customer4',
  holderName: 'Sam Park',
  unitPrice: null,
  totalPrice: '155.00',
  tickets: [
    {
      ...ORDERS[0].tickets[1],
      id: 'e1111111-1111-4111-8111-111111111111',
      code: 'BCDFGHJK2345',
      seat: { section: '115', row: 4, seat: 2, rowLabel: 'D', seatLabel: '2' },
      price: '95.00',
      levelName: 'Courtside',
    },
    {
      ...ORDERS[0].tickets[1],
      id: 'e2222222-2222-4222-8222-222222222222',
      code: 'LMNPQRST6789',
      seat: { section: '115', row: 6, seat: 7, rowLabel: 'F', seatLabel: '7' },
      price: '60.00',
      levelName: 'Lower sideline',
    },
  ],
};

describe('price levels and prices (spec 038 FR-026, FR-030, research R17)', () => {
  it('has a Price level column with the levels of each order, none for general admission', async () => {
    stubApi({
      [`GET /events/${EVENT.id}`]: json(EVENT),
      [`GET ${PATH}`]: json([...ORDERS, SEATED]),
    });
    renderPage();

    expect(await screen.findByRole('columnheader', { name: 'Price level' })).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.indexOf('Price level')).toBe(headers.indexOf('Tier') + 1);

    const seated = screen.getByText('customer4').closest('tr') as HTMLElement;
    const cells = within(seated)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells[headers.indexOf('Price level')]).toBe('Courtside, Lower sideline');
    // A seated order has no ticket type, and is not general admission.
    expect(cells[headers.indexOf('Tier')]).toBe('');
    expect(within(seated).getByText('$155.00')).toBeInTheDocument();

    const ga = screen.getByText('customer3').closest('tr') as HTMLElement;
    const gaCells = within(ga)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(gaCells[headers.indexOf('Price level')]).toBe('');
    expect(gaCells[headers.indexOf('Tier')]).toBe('VIP');
  });

  it("shows each seated ticket's seat, level and own price", async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([SEATED]) });
    renderPage();

    const row = (await screen.findByText('customer4')).closest('tr') as HTMLElement;
    const items = within(row)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'BCDFGHJK2345 Section 115, Row D, Seat 2, Courtside, $95.00',
      'LMNPQRST6789 Section 115, Row F, Seat 7, Lower sideline, $60.00',
    ]);
  });

  it("shows no per-ticket price on a general-admission order's tickets, which share its price", async () => {
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json(ORDERS) });
    renderPage();

    const row = (await screen.findByText('customer3')).closest('tr') as HTMLElement;
    const items = within(row)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items.join(' ')).not.toContain('$');
  });

  it("shows each ticket's price when an order has no unit price, even without a seat", async () => {
    const mixed = {
      ...ORDERS[0],
      unitPrice: null,
      tickets: [
        { ...ORDERS[0].tickets[0], price: '80.00' },
        { ...ORDERS[0].tickets[1], price: '88.60' },
      ],
    };
    stubApi({ [`GET /events/${EVENT.id}`]: json(EVENT), [`GET ${PATH}`]: json([mixed]) });
    renderPage();

    const row = (await screen.findByText('customer3')).closest('tr') as HTMLElement;
    const items = within(row)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items[0]).toContain('$80.00');
    expect(items[1]).toContain('$88.60');
  });
});
