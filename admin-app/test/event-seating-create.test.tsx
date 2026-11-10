import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';

/**
 * Spec 008 US6 (FR-018; research R9): at a venue with a layout, the Schedule event form sets up
 * reserved seating, ticket types, and each section's ticket type in one go; spec 031 (FR-008):
 * in one request.
 */
afterEach(() => vi.unstubAllGlobals());

const LAYOUT = {
  locationId: VENUE.id,
  totalSeats: 30,
  sections: [
    { id: 's-front', name: 'front', rows: 1, seatsPerRow: 10 },
    { id: 's-middle', name: 'middle', rows: 1, seatsPerRow: 10 },
    { id: 's-back', name: 'back', rows: 1, seatsPerRow: 10 },
  ],
};
const PLAIN = { ...VENUE, id: 'v-plain', name: 'Plain Hall' };
const SEATED_EVENT = { ...EVENT, reservedSeating: true, totalTicketCapacity: 30 };

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
  'GET /locations': json([{ ...VENUE, seatingCapacity: 30 }, PLAIN]),
  [`GET /locations/${VENUE.id}/layout`]: json(LAYOUT),
  'GET /locations/v-plain/layout': json({ locationId: 'v-plain', totalSeats: 0, sections: [] }),
});

const fillBasics = async (venueId: string) => {
  fireEvent.change(await screen.findByLabelText('Event name'), {
    target: { value: 'Season Opener' },
  });
  await screen.findByRole('option', { name: /Plain Hall/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: venueId } });
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-05-01T18:00' } });
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-05-01T21:00' } });
};

const typeLine = (n: number, name: string, price: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: `Ticket type ${n} name` }), {
    target: { value: name },
  });
  fireEvent.change(screen.getByRole('textbox', { name: `Ticket type ${n} price` }), {
    target: { value: price },
  });
};

describe('Schedule event at a venue with a layout', () => {
  it('shows tickets and seating, with no total to type', async () => {
    stubApi(baseRoutes());
    renderNew();
    await fillBasics(VENUE.id);

    const region = await screen.findByRole('group', { name: 'Tickets and seating' });
    expect(within(region).getByRole('radio', { name: 'Reserved seating' })).toBeChecked();
    expect(within(region).getByRole('radio', { name: 'General admission' })).not.toBeChecked();
    expect(screen.queryByLabelText('Total tickets')).toBeNull();
    for (const name of ['front', 'middle', 'back']) {
      expect(
        within(region).getByRole('combobox', { name: `Section ${name} ticket type` }),
      ).toBeInTheDocument();
    }
  });

  it('totals each ticket type from the sections it sells', async () => {
    stubApi(baseRoutes());
    renderNew();
    await fillBasics(VENUE.id);
    await screen.findByRole('group', { name: 'Tickets and seating' });

    typeLine(1, 'Floor', '80.00');
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    typeLine(2, 'Balcony', '30.00');
    fireEvent.change(screen.getByRole('combobox', { name: 'Section middle ticket type' }), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Section back ticket type' }), {
      target: { value: '1' },
    });

    expect(screen.getByText('Floor: 10 seats')).toBeInTheDocument();
    expect(screen.getByText('Balcony: 20 seats')).toBeInTheDocument();
  });

  it('sends the event, its seating, its ticket types, and the mapping in one request, then opens it', async () => {
    // Spec 031 FR-008 (research R5): one POST /events, each type listing the sections it sells.
    const api = stubApi({
      ...baseRoutes(),
      'POST /events': json(SEATED_EVENT, 201),
    });
    renderNew();
    await fillBasics(VENUE.id);
    await screen.findByRole('group', { name: 'Tickets and seating' });
    typeLine(1, 'Floor', '80.00');
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    typeLine(2, 'Balcony', '30.00');
    fireEvent.change(screen.getByRole('combobox', { name: 'Section middle ticket type' }), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Section back ticket type' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /events']);
    expect(writes[0].body).not.toHaveProperty('totalTicketCapacity');
    expect(writes[0].body).toMatchObject({
      reservedSeating: true,
      tiers: [
        { name: 'Floor', price: '80.00', sectionIds: ['s-front'] },
        { name: 'Balcony', price: '30.00', sectionIds: ['s-middle', 's-back'] },
      ],
    });
  });

  it('saves nothing when the schedule is refused, and keeps every value', async () => {
    // Spec 031 FR-003, FR-009: the refusal is the whole schedule's; there is no event to finish.
    const message = 'Another tier of this event already has that name';
    const api = stubApi({
      ...baseRoutes(),
      'POST /events': json({ error: { code: 'TIER_NAME_TAKEN', message } }, 409),
    });
    renderNew();
    await fillBasics(VENUE.id);
    await screen.findByRole('group', { name: 'Tickets and seating' });
    typeLine(1, 'Floor', '80.00');
    fireEvent.change(screen.getByRole('combobox', { name: 'Section back ticket type' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Finish on the event page' })).toBeNull();
    expect(api.calls.filter((c) => c.method !== 'GET').map((c) => c.path)).toEqual(['/events']);
    expect(screen.getByLabelText('Event name')).toHaveValue('Season Opener');
    expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('Floor');
    expect(screen.getByRole('combobox', { name: 'Section back ticket type' })).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Reserved seating' })).toBeChecked();
    expect(screen.queryByText('Event page')).toBeNull();
  });

  it('keeps the plain form for general admission', async () => {
    stubApi(baseRoutes());
    renderNew();
    await fillBasics(VENUE.id);
    fireEvent.click(await screen.findByRole('radio', { name: 'General admission' }));

    expect(screen.getByLabelText('Total tickets')).toBeInTheDocument();
    // Spec 008 US7: general admission still takes ticket types, each with a quantity.
    expect(screen.getByLabelText('Ticket type 1 quantity')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Section front ticket type' })).toBeNull();
  });

  it('shows no tickets and seating for a venue without a layout', async () => {
    stubApi(baseRoutes());
    renderNew();
    await fillBasics('v-plain');

    await vi.waitFor(() => expect(screen.getByLabelText('Total tickets')).toBeInTheDocument());
    expect(screen.getByRole('group', { name: 'Tickets and seating' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Reserved seating' })).toBeNull();
  });
});
