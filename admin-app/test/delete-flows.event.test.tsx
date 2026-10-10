import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { EventList } from '../src/pages/EventList';
import { EventForm } from '../src/pages/EventForm';
import { deleteEvent } from '../src/api/events';
import conflict409 from './fixtures/conflict-409.json';
import { json, stubApi } from './helpers/api-stub';

/** Spec 002 FR-010, FR-026, FR-027, US2-8; research R4, R5. */
const VENUE = {
  id: '6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e',
  name: 'Yum Center',
  address: '1 Arena Plaza',
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
const PATH = `/events/${EVENT.id}`;

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events" element={<EventList />} />
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );

const base = (del: Parameters<typeof stubApi>[0][string]) =>
  stubApi({ [`GET ${PATH}`]: json(EVENT), 'GET /events': json([]), [`DELETE ${PATH}`]: del });

let confirmSpy: MockInstance<typeof window.confirm>;
beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const clickDelete = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

describe('Deleting an event', () => {
  it('asks first, naming the event, and sends nothing when cancelled', async () => {
    confirmSpy.mockReturnValue(false);
    const api = base(json(null, 204));
    renderApp();
    await clickDelete();
    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete the event "Season Opener"? This cannot be undone.',
    );
    expect(api.count('DELETE', PATH)).toBe(0);
  });

  it('on success, returns to the list and says it was deleted', async () => {
    confirmSpy.mockReturnValue(true);
    base(json(null, 204));
    renderApp();
    await clickDelete();
    expect(await screen.findByText('Deleted "Season Opener".')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
  });

  it('when someone else deleted it first, returns to a freshly fetched list', async () => {
    confirmSpy.mockReturnValue(true);
    const api = base(json({ error: { code: 'NOT_FOUND', message: 'gone' } }, 404));
    renderApp();
    await clickDelete();
    expect(
      await screen.findByText('"Season Opener" no longer exists. The list has been refreshed.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.count('GET', '/events')).toBe(1));
  });

  it('disables the button while deleting', async () => {
    confirmSpy.mockReturnValue(true);
    let release!: () => void;
    const api = base(
      () =>
        new Promise<Response>((r) => {
          release = () => r(json(null, 204));
        }),
    );
    renderApp();
    await clickDelete();
    expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(api.count('DELETE', PATH)).toBe(1);
    release();
    expect(await screen.findByText('Deleted "Season Opener".')).toBeInTheDocument();
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

/** Spec 002 US3 regression: after the blocking event is deleted, the refused booking succeeds. */
describe('Deleting the blocking event frees its window', () => {
  it('shows the conflict banner, then saves once the blocking event is deleted', async () => {
    let blockerDeleted = false;
    const created = { ...EVENT, id: '33333333-3333-4333-8333-333333333333', name: 'Clashing Show' };
    stubApi({
      'GET /locations': json([VENUE]),
      [`DELETE ${PATH}`]: () => {
        blockerDeleted = true;
        return json(null, 204);
      },
      'POST /events': () => (blockerDeleted ? json(created, 201) : json(conflict409, 409)),
      // Spec 008 US7: the event's ticket type is created right after it.
      [`POST /events/${created.id}/tiers`]: json(
        { id: 't-gen', eventId: created.id, name: 'General', price: '45.00', quantity: 500 },
        201,
      ),
    });
    render(
      <MemoryRouter initialEntries={['/events/new']}>
        <Routes>
          <Route path="/events/new" element={<EventForm />} />
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await screen.findByRole('option', { name: /Yum Center/ });
    await user.type(screen.getByLabelText('Event name'), 'Clashing Show');
    await user.selectOptions(screen.getByLabelText('Venue'), VENUE.id);
    await user.type(screen.getByLabelText('Starts'), '2026-10-01T20:00');
    await user.type(screen.getByLabelText('Ends'), '2026-10-01T23:00');
    await user.type(screen.getByLabelText('Total tickets'), '500');
    // Spec 008 US7: priced by a ticket type instead of a base price.
    await user.type(screen.getByLabelText('Ticket type 1 name'), 'General');
    await user.type(screen.getByLabelText('Ticket type 1 price'), '45.00');
    await user.type(screen.getByLabelText('Ticket type 1 quantity'), '500');

    await user.click(screen.getByRole('button', { name: /Schedule event/i }));
    expect(await screen.findByText('Venue already committed')).toBeInTheDocument();

    await deleteEvent(EVENT.id);

    // The form kept the admin's values (FR-030), so resubmitting needs no retyping.
    await user.click(screen.getByRole('button', { name: /Schedule event/i }));
    expect(await screen.findByText('Event saved.')).toBeInTheDocument();
  });
});
