import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Attendees } from '../src/pages/Attendees';
import { Reports } from '../src/pages/Reports';
import { json, stubApi } from './helpers/api-stub';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';
import { EVENT, ORDERS, REPORT } from './fixtures-005';

/**
 * Spec 041 FR-020 (T035): the sales report gives each event's pass tickets and pass revenue, and
 * their totals in its total row; the attendee list marks each order bought on a pass with its
 * Season in a Pass column.
 */
fixTimeBeforeFixtures();
afterEach(() => vi.unstubAllGlobals());

const WITH_PASSES = {
  ...REPORT,
  totals: { ...REPORT.totals, passTicketsSold: 3, passRevenue: '100.00' },
  events: REPORT.events.map((e, i) => ({
    ...e,
    passTicketsSold: i === 0 ? 3 : 0,
    passRevenue: i === 0 ? '100.00' : '0.00',
  })),
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports" element={<Reports />} />
        <Route path="/events/:id/attendees" element={<Attendees />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Pass sales on the Reports page', () => {
  it('shows each event’s pass tickets and pass revenue, and the totals in the total row', async () => {
    stubApi({ 'GET /reports/sales': json(WITH_PASSES) });
    renderAt('/reports');
    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Event',
      'Venue',
      'Date',
      'Sold',
      'Revenue',
      'Pass tickets',
      'Pass revenue',
      'Checked in',
    ]);
    const opener = within(table).getByRole('link', { name: 'Season Opener' }).closest('tr')!;
    const cells = within(opener as HTMLElement).getAllByRole('cell');
    expect(cells[5]).toHaveTextContent('3');
    expect(cells[6]).toHaveTextContent('$100.00');
    const total = within(table).getByRole('rowheader', { name: 'Total' }).closest('tr')!;
    expect(total).toHaveTextContent('$4,321.50');
    const totalCells = within(total as HTMLElement).getAllByRole('cell');
    expect(totalCells.map((c) => c.textContent)).toContain('3');
    expect(totalCells.map((c) => c.textContent)).toContain('$100.00');
  });
});

describe('The Pass column of the attendee list', () => {
  it('names the Season of an order bought on a pass, and is empty for single orders', async () => {
    const orders = ORDERS.map((o, i) => ({
      ...o,
      seasonPass: i === 0 ? { id: 'p1', seasonId: 's1', seasonName: 'Louisville Hoops' } : null,
    }));
    stubApi({
      [`GET /events/${EVENT.id}`]: json(EVENT),
      [`GET /events/${EVENT.id}/attendees`]: json(orders),
    });
    renderAt(`/events/${EVENT.id}/attendees`);
    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers.indexOf('Pass')).toBe(headers.indexOf('Status') + 1);
    const first = screen.getByText('customer3').closest('tr') as HTMLElement;
    expect(within(first).getByText('Louisville Hoops')).toBeInTheDocument();
    const second = screen.getByText('customer1').closest('tr') as HTMLElement;
    expect(within(second).queryByText('Louisville Hoops')).not.toBeInTheDocument();
  });
});
