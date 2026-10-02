import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { EventList } from '../src/pages/EventList';
import { LocationList } from '../src/pages/LocationList';
import { json, stubApi } from './helpers/api-stub';
import events from './fixtures/events.json';
import locations from './fixtures/locations.json';

/** Spec 004 US2 and US3 (FR-006–FR-009): event and venue search in the Admin app. */
afterEach(() => vi.unstubAllGlobals());

let currentUrl = '';
function UrlSpy() {
  const loc = useLocation();
  currentUrl = `${loc.pathname}${loc.search}`;
  return null;
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <UrlSpy />
      <Routes>
        <Route path="/events" element={<EventList />} />
        <Route path="/locations" element={<LocationList />} />
      </Routes>
    </MemoryRouter>,
  );

/** Local midnight of a calendar day, as the instant the Admin app sends. */
const localMidnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

const eventSearches = (calls: { method: string; path: string; search: string }[]) =>
  calls
    .filter((c) => c.method === 'GET' && c.path === '/events')
    .map((c) => Object.fromEntries(new URLSearchParams(c.search)));

describe('Event search', () => {
  it('sends the name, venue, and local-day date range, and puts them in the address', async () => {
    const { calls } = stubApi({ 'GET /events': json(events), 'GET /locations': json(locations) });
    renderAt('/events');
    await screen.findByText('Season Opener');

    await userEvent.type(screen.getByLabelText('Search events'), '  opener ');
    await userEvent.selectOptions(screen.getByLabelText('Venue'), locations[0].id);
    await userEvent.type(screen.getByLabelText('From'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('To'), '2026-10-31');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await vi.waitFor(() => expect(eventSearches(calls)).toHaveLength(2));
    expect(eventSearches(calls)[1]).toEqual({
      q: 'opener',
      locationId: locations[0].id,
      from: localMidnight(2026, 10, 1),
      // The whole "to" day is included: the bound is the next local midnight.
      to: localMidnight(2026, 11, 1),
    });
    const params = new URLSearchParams(currentUrl.split('?')[1]);
    expect(Object.fromEntries(params)).toEqual({
      q: 'opener',
      venue: locations[0].id,
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('applies filters already in the address on arrival, and fills the form with them', async () => {
    const { calls } = stubApi({ 'GET /events': json([]), 'GET /locations': json(locations) });
    renderAt('/events?q=gala&from=2026-12-01');

    expect(await screen.findByText('No events match these filters.')).toBeInTheDocument();
    expect(eventSearches(calls)[0]).toEqual({ q: 'gala', from: localMidnight(2026, 12, 1) });
    expect(screen.getByLabelText('Search events')).toHaveValue('gala');
    expect(screen.getByLabelText('From')).toHaveValue('2026-12-01');
  });

  it('clears every filter', async () => {
    const { calls } = stubApi({ 'GET /events': json(events), 'GET /locations': json(locations) });
    renderAt('/events?q=zzz');
    await screen.findByLabelText('Search events');

    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await vi.waitFor(() => expect(currentUrl).toBe('/events'));
    await vi.waitFor(() => expect(eventSearches(calls).at(-1)).toEqual({}));
    expect(screen.getByLabelText('Search events')).toHaveValue('');
  });

  it('refuses a from date after the to date without asking the Backend', async () => {
    const { calls } = stubApi({ 'GET /events': json(events), 'GET /locations': json(locations) });
    renderAt('/events');
    await screen.findByText('Season Opener');

    await userEvent.type(screen.getByLabelText('From'), '2026-11-05');
    await userEvent.type(screen.getByLabelText('To'), '2026-11-01');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('From must be on or before To');
    expect(eventSearches(calls)).toHaveLength(1);
  });
});

describe('Venue search', () => {
  it('sends q, keeps it in the address, and says when nothing matches', async () => {
    const { calls } = stubApi({ 'GET /locations': json([]) });
    renderAt('/locations');
    await screen.findByLabelText('Search venues');

    await userEvent.type(screen.getByLabelText('Search venues'), 'lexington');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No venues match "lexington".')).toBeInTheDocument();
    expect(currentUrl).toBe('/locations?q=lexington');
    const last = calls.filter((c) => c.path === '/locations').at(-1);
    expect(new URLSearchParams(last?.search).get('q')).toBe('lexington');
  });

  it('reads q from the address on arrival', async () => {
    const { calls } = stubApi({ 'GET /locations': json(locations) });
    renderAt('/locations?q=arena');
    await screen.findByText(locations[0].name);
    expect(screen.getByLabelText('Search venues')).toHaveValue('arena');
    expect(new URLSearchParams(calls[0].search).get('q')).toBe('arena');
  });
});
