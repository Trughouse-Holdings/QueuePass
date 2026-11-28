import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Seasons } from '../src/pages/Seasons';
import { json, stubApi } from './helpers/api-stub';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';
import { season } from './fixtures-041';

fixTimeBeforeFixtures();
afterEach(() => vi.unstubAllGlobals());

const renderList = () =>
  render(
    <MemoryRouter initialEntries={['/seasons']}>
      <Routes>
        <Route path="/seasons" element={<Seasons />} />
      </Routes>
    </MemoryRouter>,
  );

/** Spec 041 FR-018 (T019): the Seasons list. */
describe('Seasons list', () => {
  it('shows each Season: name, venue, sport and team, events, status, passes sold, pass revenue', async () => {
    stubApi({
      'GET /seasons': json([
        season({
          status: 'ON_SALE',
          singleSalesOpenAt: '2026-09-28T14:00:00.000Z',
          passesSold: 3,
          passRevenue: '480.00',
        }),
        season({ id: 'c2', name: 'Concert Series', sport: null, team: null, events: [] }),
        season({ id: 'c3', name: 'Old Season', status: 'CANCELLED' }),
        season({
          id: 'c4',
          name: 'Done Season',
          status: 'ON_SALE',
          salesEndAt: '2026-09-20T00:00:00Z',
        }),
        season({ id: 'c5', name: 'Open Season', status: 'ON_SALE' }),
      ]),
    });
    renderList();
    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Season',
      'Venue',
      'Sport and team',
      'Events',
      'Status',
      'Passes sold',
      'Pass revenue',
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    const cells = (i: number) =>
      within(rows[i]!)
        .getAllByRole('cell')
        .map((c) => c.textContent);
    expect(cells(0)).toEqual([
      'Spring Hoops',
      'KFC Yum! Center',
      'Basketball · Louisville Cardinals',
      '2',
      'Presale until Sep 28, 2026, 10:00 AM EDT',
      '3',
      '$480.00',
    ]);
    expect(cells(1)).toEqual([
      'Concert Series',
      'KFC Yum! Center',
      '—',
      '0',
      'Draft',
      '0',
      '$0.00',
    ]);
    expect(cells(2)[4]).toBe('Cancelled');
    expect(cells(3)[4]).toBe('Sales ended');
    expect(cells(4)[4]).toBe('On sale');
    expect(screen.getByRole('link', { name: 'Spring Hoops' })).toHaveAttribute(
      'href',
      `/seasons/${season().id}`,
    );
    expect(screen.getByRole('link', { name: /New season/ })).toHaveAttribute(
      'href',
      '/seasons/new',
    );
    expect(screen.getByText('5 seasons')).toBeInTheDocument();
  });

  it('says when there are none', async () => {
    stubApi({ 'GET /seasons': json([]) });
    renderList();
    expect(await screen.findByText('No seasons yet')).toBeInTheDocument();
  });

  it('says when the list could not be loaded', async () => {
    stubApi({
      'GET /seasons': json({ error: { code: 'VALIDATION_FAILED', message: 'Down.' } }, 500),
    });
    renderList();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load seasons');
  });
});
