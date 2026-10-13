import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocationDetail } from '../src/pages/LocationDetail';
import { LocationList } from '../src/pages/LocationList';
import { json, stubApi } from './helpers/api-stub';

/** Spec 002 FR-004, FR-026, FR-027, FR-029, US1-6, US1-7; research R4, R5. */
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
  totalTicketCapacity: 100,
  basePrice: '10.00',
  createdAt: VENUE.createdAt,
  updatedAt: VENUE.updatedAt,
};
const PATH = `/locations/${VENUE.id}`;
const REFUSAL = {
  error: {
    code: 'VENUE_HAS_EVENTS',
    message:
      'Cannot delete "Yum Center": 1 event is still scheduled there. Delete or move them first.',
    details: { eventCount: 1 },
  },
};

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/locations" element={<LocationList />} />
        <Route path="/locations/:id" element={<LocationDetail />} />
      </Routes>
    </MemoryRouter>,
  );

const base = (del: Parameters<typeof stubApi>[0][string], events: unknown[] = []) =>
  stubApi({
    [`GET ${PATH}`]: json(VENUE),
    'GET /events': json(events),
    'GET /locations': json([]),
    [`DELETE ${PATH}`]: del,
  });

let confirmSpy: MockInstance<typeof window.confirm>;
beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function clickDelete() {
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
}

describe('Deleting a venue', () => {
  it('asks first, naming the venue, and sends nothing when cancelled', async () => {
    confirmSpy.mockReturnValue(false);
    const api = base(json(null, 204));
    renderApp();
    await clickDelete();

    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete the venue "Yum Center"? This cannot be undone.',
    );
    expect(api.count('DELETE', PATH)).toBe(0);
    expect(screen.getByRole('heading', { name: 'Yum Center' })).toBeInTheDocument();
  });

  it('on success, returns to the list and says it was deleted', async () => {
    confirmSpy.mockReturnValue(true);
    base(json(null, 204));
    renderApp();
    await clickDelete();

    expect(await screen.findByText('Deleted "Yum Center".')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Venues' })).toBeInTheDocument();
  });

  it('when events remain, stays put and explains, with the events still listed', async () => {
    confirmSpy.mockReturnValue(true);
    base(json(REFUSAL, 409), [EVENT]);
    renderApp();
    await clickDelete();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Could not delete');
    expect(banner).toHaveTextContent(REFUSAL.error.message);
    expect(screen.getByRole('link', { name: 'Season Opener' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('when someone else deleted it first, returns to a freshly fetched list', async () => {
    confirmSpy.mockReturnValue(true);
    const api = base(json({ error: { code: 'NOT_FOUND', message: 'gone' } }, 404));
    renderApp();
    await clickDelete();

    expect(
      await screen.findByText('"Yum Center" no longer exists. The list has been refreshed.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.count('GET', '/locations')).toBe(1));
  });

  it('disables the button while deleting, so a double click sends one request', async () => {
    confirmSpy.mockReturnValue(true);
    let release!: () => void;
    const api = base(
      () =>
        new Promise<Response>((r) => {
          release = () => r(json(null, 204));
        }),
    );
    renderApp();
    const button = await screen.findByRole('button', { name: 'Delete' });

    await userEvent.click(button);
    expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Deleting…' }));
    expect(api.count('DELETE', PATH)).toBe(1);
    release();
    expect(await screen.findByText('Deleted "Yum Center".')).toBeInTheDocument();
  });

  it('says plainly when the Backend cannot be reached', async () => {
    confirmSpy.mockReturnValue(true);
    base('network-error');
    renderApp();
    await clickDelete();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the QueuePass service.",
    );
  });
});
