import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Reports } from '../src/pages/Reports';
import { EventDetail } from '../src/pages/EventDetail';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, REPORT } from './fixtures-005';

/** Spec 005 US2 (FR-005, FR-006): the Reports page and the event page's Sales card. */
afterEach(() => vi.unstubAllGlobals());

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reports" element={<Reports />} />
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Reports page', () => {
  it('shows the totals', async () => {
    stubApi({ 'GET /reports/sales': json(REPORT) });
    renderAt('/reports');

    const totals = within(await screen.findByRole('region', { name: 'Totals' }));
    expect(totals.getByText('75 of 300')).toBeInTheDocument();
    expect(totals.getByText('$4,321.50')).toBeInTheDocument();
    expect(totals.getByText('12')).toBeInTheDocument();
    expect(totals.getByText('2')).toBeInTheDocument();
  });

  it('lists every event with sold of capacity, percent, revenue, and check-ins', async () => {
    stubApi({ 'GET /reports/sales': json(REPORT) });
    renderAt('/reports');

    const row = (await screen.findByRole('link', { name: 'Season Opener' })).closest(
      'tr',
    ) as HTMLElement;
    expect(screen.getByRole('link', { name: 'Season Opener' })).toHaveAttribute(
      'href',
      `/events/${EVENT.id}`,
    );
    expect(within(row).getByText('25 of 100 (25%)')).toBeInTheDocument();
    expect(within(row).getByText('$1,321.50')).toBeInTheDocument();
    expect(within(row).getByText('Yum Center')).toBeInTheDocument();

    const cancelled = screen.getByRole('link', { name: 'Rained Out' }).closest('tr') as HTMLElement;
    expect(within(cancelled).getByText('Cancelled')).toBeInTheDocument();
  });

  it('says so when the report cannot load', async () => {
    stubApi({ 'GET /reports/sales': 'network-error' });
    renderAt('/reports');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the QueuePass service.",
    );
  });
});

describe('Sales card on the event page', () => {
  it('shows the event sold, revenue, check-ins, and each tier', async () => {
    stubApi({
      [`GET /events/${EVENT.id}`]: json(EVENT),
      [`GET /events/${EVENT.id}/tiers`]: json([]),
      'GET /reports/sales': json(REPORT),
    });
    renderAt(`/events/${EVENT.id}`);

    const card = within(await screen.findByRole('region', { name: 'Sales' }));
    expect(await card.findByText('25 of 100 tickets sold')).toBeInTheDocument();
    expect(card.getByText('$1,321.50')).toBeInTheDocument();
    expect(card.getByText('12 checked in')).toBeInTheDocument();
    const vip = card.getByText('VIP').closest('tr') as HTMLElement;
    expect(within(vip).getByText('5 of 20')).toBeInTheDocument();
    expect(within(vip).getByText('$421.50')).toBeInTheDocument();
  });
});
