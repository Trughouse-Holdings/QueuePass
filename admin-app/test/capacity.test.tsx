import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { EventForm } from '../src/pages/EventForm';
import { LocationForm } from '../src/pages/LocationForm';
import { TierSection } from '../src/components/TierSection';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';
import { setLocalDateTime } from './helpers/event-times';

/**
 * Spec 007 FR-006, FR-017–FR-019 (research R11): no capacity or tier amount is typed in the
 * seated flow, and a new event's capacity may be left blank.
 */
afterEach(() => vi.unstubAllGlobals());

// Spec 038 FR-009: a venue's layouts; its capacity is the largest one's.
const LAYOUTS = [
  { id: 'l-a', locationId: VENUE.id, name: 'Standard', seatCount: 70 },
  { id: 'l-b', locationId: VENUE.id, name: 'Small', seatCount: 40 },
];
const SEATED = { ...EVENT, reservedSeating: true, totalTicketCapacity: 70 } as Event;

const at = (path: string, route: string, element: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );

describe('venue form', () => {
  it("shows a laid-out venue's capacity as its largest layout's, read-only, and never sends it", async () => {
    const api = stubApi({
      [`GET /locations/${VENUE.id}`]: json({ ...VENUE, seatingCapacity: 70 }),
      [`GET /locations/${VENUE.id}/layouts`]: json(LAYOUTS),
      [`PATCH /locations/${VENUE.id}`]: json({ ...VENUE, seatingCapacity: 70 }),
    });
    at(`/locations/${VENUE.id}/edit`, '/locations/:id/edit', <LocationForm />);

    expect(await screen.findByText('From the largest layout (70 seats)')).toBeInTheDocument();
    expect(screen.getByLabelText('Seating capacity')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Seating capacity')).toHaveValue(70);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(api.count('PATCH', `/locations/${VENUE.id}`)).toBe(1));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).not.toHaveProperty('seatingCapacity');
  });

  it('keeps the capacity field for a venue without a layout', async () => {
    stubApi({
      [`GET /locations/${VENUE.id}`]: json(VENUE),
      [`GET /locations/${VENUE.id}/layouts`]: json([]),
    });
    at(`/locations/${VENUE.id}/edit`, '/locations/:id/edit', <LocationForm />);

    expect(await screen.findByLabelText('Seating capacity')).toHaveValue(22090);
  });
});

describe('event form', () => {
  it("lets a new event's capacity be left blank, and leaves it out of the request", async () => {
    const api = stubApi({
      'GET /locations': json([VENUE]),
      // Spec 031 FR-008: the ticket type goes in the one POST /events.
      'POST /events': json(EVENT, 201),
    });
    at('/events/new', '/events/new', <EventForm />);

    fireEvent.change(await screen.findByLabelText('Event name'), { target: { value: 'Blank' } });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
    setLocalDateTime('Starts', '2030-05-01T18:00');
    setLocalDateTime('Ends', '2030-05-01T21:00');
    await screen.findByLabelText('Ticket type 1 name');
    fireEvent.change(screen.getByLabelText('Ticket type 1 name'), { target: { value: 'General' } });
    fireEvent.change(screen.getByLabelText('Ticket type 1 price'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByLabelText('Ticket type 1 quantity'), { target: { value: '10' } });
    expect(screen.getByLabelText('Total tickets')).not.toBeRequired();
    expect(screen.getByText(/Leave blank to use the venue's capacity/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    await vi.waitFor(() => expect(api.count('POST', '/events')).toBe(1));
    expect(api.calls.find((c) => c.method === 'POST')?.body).not.toHaveProperty(
      'totalTicketCapacity',
    );
  });

  it("shows a seated event's capacity as set by the layout, and never sends it", async () => {
    const api = stubApi({
      'GET /locations': json([VENUE]),
      [`GET /events/${EVENT.id}`]: json(SEATED),
      [`PATCH /events/${EVENT.id}`]: json(SEATED),
    });
    at(`/events/${EVENT.id}/edit`, '/events/:id/edit', <EventForm />);

    expect(
      await screen.findByText("Total tickets: 70, set by the venue's seating layout."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Total tickets')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(api.count('PATCH', `/events/${EVENT.id}`)).toBe(1));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).not.toHaveProperty(
      'totalTicketCapacity',
    );
  });
});

describe('tier section on a seated event', () => {
  const VIP = {
    id: 't-vip',
    eventId: EVENT.id,
    name: 'VIP',
    price: '120.00',
    quantity: 30,
    createdAt: EVENT.createdAt,
    updatedAt: EVENT.updatedAt,
  };

  it('takes only a name and price, and shows each amount as calculated from its sections', async () => {
    const api = stubApi({
      [`GET /events/${EVENT.id}/tiers`]: json([VIP]),
      [`POST /events/${EVENT.id}/tiers`]: json(
        { ...VIP, id: 't-gen', name: 'General', quantity: 0 },
        201,
      ),
    });
    render(<TierSection event={SEATED} />);

    const region = await screen.findByRole('region', { name: 'Ticket tiers' });
    expect(
      await within(region).findByText(
        'Seats per tier come from the sections mapped in Seating below.',
      ),
    ).toBeInTheDocument();
    const form = within(region).getByRole('form', { name: 'Add a tier' });
    expect(within(form).queryByLabelText('Quantity')).toBeNull();

    fireEvent.change(within(form).getByLabelText('Tier name'), { target: { value: 'General' } });
    fireEvent.change(within(form).getByLabelText('Price'), { target: { value: '40.00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add tier' }));

    await vi.waitFor(() => expect(api.count('POST', `/events/${EVENT.id}/tiers`)).toBe(1));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'General',
      price: '40.00',
    });
  });
});
