import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocationDetail } from '../src/pages/LocationDetail';
import { json, stubApi } from './helpers/api-stub';

/** Spec 002 FR-024, US1-2; research R6. */
const VENUE = {
  id: '6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e',
  name: 'Yum Center',
  address: '1 Arena Plaza, Louisville, KY 40202',
  street: '1 Arena Plaza',
  city: 'Louisville',
  state: 'KY',
  zip: '40202',
  addressVerified: false,
  seatingCapacity: 22090,
  createdAt: '2026-09-20T18:57:51.352Z',
  updatedAt: '2026-09-20T18:57:51.352Z',
};
const EVENT = {
  id: 'b92fc02c-6013-470d-a3bf-bf53648b0ebc',
  name: 'Season Opener',
  locationId: VENUE.id,
  location: VENUE,
  startsAt: '2026-10-01T22:00:00.000Z',
  endsAt: '2026-10-02T01:00:00.000Z',
  totalTicketCapacity: 18000,
  basePrice: '45.00',
  createdAt: VENUE.createdAt,
  updatedAt: VENUE.updatedAt,
};
const PATH = `/locations/${VENUE.id}`;

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/locations/:id" element={<LocationDetail />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('LocationDetail', () => {
  it('shows the venue and the events scheduled there, each linking to its page', async () => {
    const api = stubApi({ [`GET ${PATH}`]: json(VENUE), 'GET /events': json([EVENT]) });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Yum Center' })).toBeInTheDocument();
    expect(screen.getByText('1 Arena Plaza, Louisville, KY 40202')).toBeInTheDocument();
    expect(screen.getByText('22,090')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Season Opener' })).toHaveAttribute(
      'href',
      `/events/${EVENT.id}`,
    );
    expect(api.calls.find((c) => c.path === '/events')?.search).toBe(`?locationId=${VENUE.id}`);
  });

  it('offers Edit and Delete', async () => {
    stubApi({ [`GET ${PATH}`]: json(VENUE), 'GET /events': json([]) });
    renderPage();
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `${PATH}/edit`,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('says so when nothing is scheduled', async () => {
    stubApi({ [`GET ${PATH}`]: json(VENUE), 'GET /events': json([]) });
    renderPage();
    expect(await screen.findByText('Nothing is scheduled here.')).toBeInTheDocument();
  });

  it('explains a venue that no longer exists, with a way back', async () => {
    stubApi({
      [`GET ${PATH}`]: json({ error: { code: 'NOT_FOUND', message: 'gone' } }, 404),
      'GET /events': json([]),
    });
    renderPage();
    expect(await screen.findByText('This venue no longer exists.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to venues/i })).toHaveAttribute(
      'href',
      '/locations',
    );
  });

  it('says plainly when the Backend cannot be reached', async () => {
    stubApi({ [`GET ${PATH}`]: 'network-error', 'GET /events': 'network-error' });
    renderPage();
    expect(await screen.findByText("Can't reach the QueuePass service.")).toBeInTheDocument();
  });
});
