import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';
import { layoutRoutes } from './fixtures-038';
import { setLocalDateTime } from './helpers/event-times';

/**
 * Spec 008 US6 (FR-018; research R9), as spec 038 US2 changes it (FR-010, FR-015): at a venue with
 * layouts, the Schedule event form offers general admission or one of its layouts; a seated event
 * has no ticket types and no total to type, and is saved with its seating in one request (031).
 */
afterEach(() => vi.unstubAllGlobals());

const PLAIN = { ...VENUE, id: 'v-plain', name: 'Plain Hall' };
const SEATED_EVENT = {
  ...EVENT,
  reservedSeating: true,
  layoutId: 'l-club',
  priceMax: '20.00',
  totalTicketCapacity: 12,
};

const renderNew = () =>
  render(
    <MemoryRouter initialEntries={['/events/new']}>
      <Routes>
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/:id" element={<p>Event page</p>} />
        <Route path="/events" element={<p>Event list</p>} />
      </Routes>
    </MemoryRouter>,
  );

const baseRoutes = () => ({
  'GET /locations': json([{ ...VENUE, seatingCapacity: 70 }, PLAIN]),
  ...layoutRoutes(),
  'GET /locations/v-plain/layouts': json([]),
});

const fillBasics = async (venueId: string) => {
  fireEvent.change(await screen.findByLabelText('Event name'), {
    target: { value: 'Season Opener' },
  });
  await screen.findByRole('option', { name: /Plain Hall/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: venueId } });
  setLocalDateTime('Starts', '2030-05-01T18:00');
  setLocalDateTime('Ends', '2030-05-01T21:00');
};

const chooseClub = async () => {
  fireEvent.change(await screen.findByRole('combobox', { name: 'Seating' }), {
    target: { value: 'l-club' },
  });
  return screen.findByRole('textbox', { name: 'Club seats price' });
};

describe('Schedule event at a venue with layouts', () => {
  it('starts on general admission, with ticket types and a total, and offers each layout', async () => {
    stubApi(baseRoutes());
    renderNew();
    await fillBasics(VENUE.id);

    const region = await screen.findByRole('group', { name: 'Tickets and seating' });
    const seating = await within(region).findByRole('combobox', { name: 'Seating' });
    expect(seating).toHaveValue('');
    expect(within(region).getByRole('option', { name: 'Club (12 seats)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Total tickets')).toBeInTheDocument();
    expect(screen.getByLabelText('Ticket type 1 quantity')).toBeInTheDocument();
  });

  it('shows no ticket types and no total to type for a layout: the total is its seats on sale', async () => {
    stubApi(baseRoutes());
    renderNew();
    await fillBasics(VENUE.id);
    await chooseClub();

    expect(screen.queryByLabelText('Total tickets')).toBeNull();
    expect(screen.queryByLabelText('Ticket type 1 name')).toBeNull();
    expect(screen.getByText('Total tickets: 12, the seats on sale.')).toBeInTheDocument();
  });

  it('sends the event and its seating in one request, then opens it', async () => {
    const api = stubApi({ ...baseRoutes(), 'POST /events': json(SEATED_EVENT, 201) });
    renderNew();
    await fillBasics(VENUE.id);
    fireEvent.change(await chooseClub(), { target: { value: '20.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /events']);
    expect(writes[0]!.body).toEqual(
      expect.objectContaining({
        layoutId: 'l-club',
        levelPrices: [{ levelId: 'l-club', price: '20.00' }],
        offSale: [],
        basePrice: '20.00',
      }),
    );
  });

  it('saves nothing when the schedule is refused, and keeps every value', async () => {
    const message = 'Club room is already committed at that time.';
    const api = stubApi({
      ...baseRoutes(),
      'POST /events': json({ error: { code: 'EVENT_CANCELLED', message } }, 409),
    });
    renderNew();
    await fillBasics(VENUE.id);
    fireEvent.change(await chooseClub(), { target: { value: '20.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method !== 'GET').map((c) => c.path)).toEqual(['/events']);
    expect(screen.getByLabelText('Event name')).toHaveValue('Season Opener');
    expect(screen.getByRole('combobox', { name: 'Seating' })).toHaveValue('l-club');
    expect(screen.getByRole('textbox', { name: 'Club seats price' })).toHaveValue('20.00');
    expect(screen.queryByText('Event page')).toBeNull();
  });

  it('shows no seating choice for a venue without layouts', async () => {
    stubApi(baseRoutes());
    renderNew();
    await fillBasics('v-plain');

    await vi.waitFor(() => expect(screen.getByLabelText('Total tickets')).toBeInTheDocument());
    expect(screen.getByRole('group', { name: 'Tickets and seating' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Seating' })).toBeNull();
  });
});
