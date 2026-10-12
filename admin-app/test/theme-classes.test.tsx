import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Attendees } from '../src/pages/Attendees';
import { EventDetail } from '../src/pages/EventDetail';
import { EventForm } from '../src/pages/EventForm';
import { LocationDetail } from '../src/pages/LocationDetail';
import { Reports } from '../src/pages/Reports';
import { json, stubApi } from './helpers/api-stub';

/**
 * Spec 012 FR-010, FR-014 (research R8, R10): key controls and "Can't reach the QueuePass
 * service" carry the shared theme's classes, with their text and roles unchanged.
 */
afterEach(() => vi.unstubAllGlobals());

const ID = 'b92fc02c-6013-470d-a3bf-bf53648b0ebc';

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="/events/:id/attendees" element={<Attendees />} />
        <Route path="/locations/:id" element={<LocationDetail />} />
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Can't reach the QueuePass service (US3-1)", () => {
  it.each([
    ['event', `/events/${ID}`, `GET /events/${ID}`],
    ['venue', `/locations/${ID}`, `GET /locations/${ID}`],
    ['attendees', `/events/${ID}/attendees`, `GET /events/${ID}/attendees`],
    ['reports', '/reports', 'GET /reports/sales'],
  ])('shows on the %s page as an error banner', async (_, url, route) => {
    stubApi({ [route]: 'network-error', [`GET /events/${ID}`]: 'network-error' });
    renderAt(url);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Can't reach the QueuePass service.");
    expect(alert).toHaveClass('banner', 'banner--error');
  });
});

it('the New event form saves with the primary button and cancels with the secondary', async () => {
  stubApi({ 'GET /locations': json([]) });
  renderAt('/events/new');
  expect(await screen.findByRole('button', { name: 'Schedule event' })).toHaveClass(
    'btn',
    'btn--primary',
  );
  expect(screen.getByRole('link', { name: 'Cancel' })).toHaveClass('btn', 'btn--ghost');
});
