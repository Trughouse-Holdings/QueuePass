import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { json, stubApi } from './helpers/api-stub';

/** Spec 002 FR-025, FR-031; research R6. */
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
// A 4-hour event whose start and end fall on different UTC dates. Assertions use the same
// formatter as the page, so they hold in any time zone the tests run in.
const EVENT = {
  id: 'b92fc02c-6013-470d-a3bf-bf53648b0ebc',
  name: 'Late Show',
  locationId: VENUE.id,
  location: VENUE,
  startsAt: '2026-10-01T22:00:00.000Z',
  endsAt: '2026-10-02T02:00:00.000Z',
  totalTicketCapacity: 18000,
  basePrice: '45.00',
  createdAt: VENUE.createdAt,
  updatedAt: VENUE.updatedAt,
};
const PATH = `/events/${EVENT.id}`;
const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('EventDetail', () => {
  it('shows the event with its venue link, dated start and end, tickets, and price', async () => {
    stubApi({ [`GET ${PATH}`]: json(EVENT) });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Late Show' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Yum Center' })).toHaveAttribute(
      'href',
      `/locations/${VENUE.id}`,
    );
    expect(screen.getByText(fmt(EVENT.startsAt))).toBeInTheDocument();
    expect(screen.getByText(fmt(EVENT.endsAt))).toBeInTheDocument();
    // Both carry a date: the formatted strings differ even though only the day changed.
    expect(fmt(EVENT.startsAt)).not.toBe(fmt(EVENT.endsAt));
    expect(screen.getByText('18,000')).toBeInTheDocument();
    expect(screen.getByText('$45.00')).toBeInTheDocument();
  });

  it('offers Edit and Delete', async () => {
    stubApi({ [`GET ${PATH}`]: json(EVENT) });
    renderPage();
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `${PATH}/edit`,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('explains an event that no longer exists, with a way back', async () => {
    stubApi({ [`GET ${PATH}`]: json({ error: { code: 'NOT_FOUND', message: 'gone' } }, 404) });
    renderPage();
    expect(await screen.findByText('This event no longer exists.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to events/i })).toHaveAttribute(
      'href',
      '/events',
    );
  });

  it('says plainly when the Backend cannot be reached', async () => {
    stubApi({ [`GET ${PATH}`]: 'network-error' });
    renderPage();
    expect(await screen.findByText("Can't reach the QueuePass service.")).toBeInTheDocument();
  });
});
