import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocationForm } from '../src/pages/LocationForm';
import { json, stubApi } from './helpers/api-stub';
import { VENUE } from './fixtures-005';

/** Spec 008 US5 (FR-017; research R8): a seated venue in one step, no capacity typed. */
afterEach(() => vi.unstubAllGlobals());

const LAYOUT_PATH = `/locations/${VENUE.id}/layout`;

const renderNew = () =>
  render(
    <MemoryRouter initialEntries={['/locations/new']}>
      <Routes>
        <Route path="/locations/new" element={<LocationForm />} />
        <Route path="/locations" element={<p>Venue list</p>} />
      </Routes>
    </MemoryRouter>,
  );

const fillNameAndAddress = () => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Seat Hall' } });
  // Spec 013: the address is four fields.
  fireEvent.change(screen.getByLabelText('Street address'), { target: { value: '1 Seat St' } });
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Louisville' } });
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'KY' } });
  fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '40202' } });
  // Spec 024 FR-002: a new venue needs its zone chosen.
  fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } });
};
const SENT_ADDRESS = { street: '1 Seat St', city: 'Louisville', state: 'KY', zip: '40202' };
// Spec 024 research R3, R4: a create sends the chosen zone and the save-even-if-unverified flag.
const SENT_ZONE = { acceptUnverifiedAddress: true, timeZone: 'America/New_York' };

const addSection = (n: number, name: string, rows: string, seats: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
  fireEvent.change(screen.getByRole('textbox', { name: `Section ${n} name` }), {
    target: { value: name },
  });
  fireEvent.change(screen.getByRole('spinbutton', { name: `Section ${n} rows` }), {
    target: { value: rows },
  });
  fireEvent.change(screen.getByRole('spinbutton', { name: `Section ${n} seats per row` }), {
    target: { value: seats },
  });
};

describe('New venue: seated or general admission', () => {
  it('starts as general admission, asking for a capacity', () => {
    stubApi({});
    renderNew();
    expect(screen.getByRole('radio', { name: 'General admission' })).toBeChecked();
    expect(screen.getByLabelText('Seating capacity')).toBeInTheDocument();
  });

  it('replaces the capacity with sections and their total when seated', () => {
    stubApi({});
    renderNew();

    fireEvent.click(screen.getByRole('radio', { name: 'Seated' }));
    expect(screen.queryByLabelText('Seating capacity')).toBeNull();
    addSection(1, 'A', '3', '10');
    addSection(2, 'B', '2', '20');
    expect(screen.getByText('Total: 70 seats')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove section 1' }));
    expect(screen.getByText('Total: 40 seats')).toBeInTheDocument();
  });

  it('creates the venue with the total, then saves its layout', async () => {
    const api = stubApi({
      'POST /locations': json({ ...VENUE, seatingCapacity: 70 }, 201),
      [`PUT ${LAYOUT_PATH}`]: json({ locationId: VENUE.id, totalSeats: 70, sections: [] }),
    });
    renderNew();

    fillNameAndAddress();
    fireEvent.click(screen.getByRole('radio', { name: 'Seated' }));
    addSection(1, 'A', '3', '10');
    addSection(2, 'B', '2', '20');
    fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));

    expect(await screen.findByText('Venue list', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /locations',
      `PUT ${LAYOUT_PATH}`,
    ]);
    expect(writes[0].body).toEqual({
      name: 'Seat Hall',
      ...SENT_ADDRESS,
      ...SENT_ZONE,
      seatingCapacity: 70,
    });
    expect(writes[1].body).toEqual({
      sections: [
        { name: 'A', rows: 3, seatsPerRow: 10 },
        { name: 'B', rows: 2, seatsPerRow: 20 },
      ],
    });
  });

  it('says so, with a way to the venue, when the layout is refused', async () => {
    const message = "section names must be unique ignoring case; 'a' repeats";
    stubApi({
      'POST /locations': json(VENUE, 201),
      [`PUT ${LAYOUT_PATH}`]: json({ error: { code: 'VALIDATION_FAILED', message } }, 400),
    });
    renderNew();

    fillNameAndAddress();
    fireEvent.click(screen.getByRole('radio', { name: 'Seated' }));
    addSection(1, 'A', '1', '5');
    addSection(2, 'a', '1', '5');
    fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent('The venue was created without its seating layout.');
    expect(within(alert).getByRole('link', { name: 'Add the layout on its page' })).toHaveAttribute(
      'href',
      `/locations/${VENUE.id}`,
    );
  });

  it('keeps general admission as before: the typed capacity and no layout request', async () => {
    const api = stubApi({ 'POST /locations': json(VENUE, 201) });
    renderNew();

    fillNameAndAddress();
    fireEvent.change(screen.getByLabelText('Seating capacity'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));

    expect(await screen.findByText('Venue list', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => c.method)).toEqual(['POST']);
    expect(writes[0].body).toEqual({
      name: 'Seat Hall',
      ...SENT_ADDRESS,
      ...SENT_ZONE,
      seatingCapacity: 500,
    });
  });
});
