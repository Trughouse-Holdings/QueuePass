import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';

/**
 * Spec 008 US7 (FR-019; research R10): no base price; every event is priced by its ticket types,
 * and editing an event changes its ticket types and section types too.
 */
afterEach(() => vi.unstubAllGlobals());

const PLAIN = { ...VENUE, id: 'v-plain', name: 'Plain Hall' };
const NO_LAYOUT = { locationId: 'v-plain', totalSeats: 0, sections: [] };
const tier = (id: string, name: string, price: string, quantity: number) => ({
  id,
  eventId: EVENT.id,
  name,
  price,
  quantity,
  createdAt: EVENT.createdAt,
  updatedAt: EVENT.updatedAt,
});

const at = (path: string, route: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<EventForm />} />
        <Route path="/events/:id" element={<p>Event page</p>} />
      </Routes>
    </MemoryRouter>,
  );

/** The edit form has loaded the event's ticket types (section selects show their names too). */
const typesLoaded = () =>
  vi.waitFor(() => expect(screen.getByLabelText('Ticket type 2 name')).toHaveValue('Balcony'));

const typeLine = (n: number, name: string, price: string, quantity?: string) => {
  fireEvent.change(screen.getByLabelText(`Ticket type ${n} name`), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(`Ticket type ${n} price`), { target: { value: price } });
  if (quantity !== undefined) {
    fireEvent.change(screen.getByLabelText(`Ticket type ${n} quantity`), {
      target: { value: quantity },
    });
  }
};

describe('scheduling a general-admission event', () => {
  it('has no base price, takes ticket types with quantities, and prices the event by the lowest', async () => {
    let tiers = 0;
    const api = stubApi({
      'GET /locations': json([PLAIN]),
      'GET /locations/v-plain/layout': json(NO_LAYOUT),
      'POST /events': json({ ...EVENT, locationId: 'v-plain' }, 201),
      [`POST /events/${EVENT.id}/tiers`]: () =>
        json(
          ++tiers === 1 ? tier('t1', 'Floor', '80.00', 100) : tier('t2', 'Lawn', '25.00', 300),
          201,
        ),
    });
    at('/events/new', '/events/new');

    await screen.findByRole('option', { name: /Plain Hall/ });
    expect(screen.queryByLabelText('Base price')).toBeNull();
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fair' } });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'v-plain' } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-05-01T18:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-05-01T21:00' } });
    typeLine(1, 'Floor', '80.00', '100');
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    typeLine(2, 'Lawn', '25.00', '300');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /events',
      `POST /events/${EVENT.id}/tiers`,
      `POST /events/${EVENT.id}/tiers`,
    ]);
    expect(writes[0].body).toMatchObject({ basePrice: '25.00' });
    expect(writes[1].body).toEqual({ name: 'Floor', price: '80.00', quantity: 100 });
    expect(writes[2].body).toEqual({ name: 'Lawn', price: '25.00', quantity: 300 });
  });

  it('asks for a quantity on a general-admission ticket type', async () => {
    const api = stubApi({
      'GET /locations': json([PLAIN]),
      'GET /locations/v-plain/layout': json(NO_LAYOUT),
    });
    at('/events/new', '/events/new');

    await screen.findByRole('option', { name: /Plain Hall/ });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'v-plain' } });
    typeLine(1, 'Floor', '80.00');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Give every ticket type a name, a price, and a quantity.',
    );
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('editing a seated event', () => {
  const SEATED = { ...EVENT, reservedSeating: true, totalTicketCapacity: 30 };
  const PATH = `/events/${EVENT.id}`;
  const routes = (extra: object = {}) => ({
    'GET /locations': json([VENUE]),
    [`GET ${PATH}`]: json(SEATED),
    [`GET ${PATH}/tiers`]: json([
      tier('t-floor', 'Floor', '80.00', 10),
      tier('t-bal', 'Balcony', '30.00', 20),
    ]),
    [`GET ${PATH}/seats`]: json({
      eventId: EVENT.id,
      reservedSeating: true,
      sections: [
        {
          sectionId: 's-front',
          name: 'front',
          rows: 1,
          seatsPerRow: 10,
          tierId: 't-floor',
          sold: 0,
          taken: [],
        },
        {
          sectionId: 's-middle',
          name: 'middle',
          rows: 1,
          seatsPerRow: 10,
          tierId: 't-bal',
          sold: 0,
          taken: [],
        },
        {
          sectionId: 's-back',
          name: 'back',
          rows: 1,
          seatsPerRow: 10,
          tierId: 't-bal',
          sold: 0,
          taken: [],
        },
      ],
    }),
    ...extra,
  });

  it('shows its ticket types and section types, prefilled, and no base price', async () => {
    stubApi(routes());
    at(`${PATH}/edit`, '/events/:id/edit');

    await typesLoaded();
    expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('Floor');
    expect(screen.getByLabelText('Ticket type 2 price')).toHaveValue('30.00');
    expect(screen.queryByLabelText('Ticket type 1 quantity')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Section back ticket type' })).toHaveValue('1');
    expect(screen.queryByLabelText('Base price')).toBeNull();
  });

  it('applies renamed, repriced, and new types and a moved section, then opens the event', async () => {
    const api = stubApi(
      routes({
        [`PATCH ${PATH}`]: json(SEATED),
        [`POST ${PATH}/tiers`]: json(tier('t-box', 'Box', '120.00', 0), 201),
        [`PATCH ${PATH}/tiers/t-bal`]: json(tier('t-bal', 'Upper', '35.00', 20)),
        [`PUT ${PATH}/seating`]: json({ eventId: EVENT.id, reservedSeating: true, sections: [] }),
      }),
    );
    at(`${PATH}/edit`, '/events/:id/edit');
    await typesLoaded();

    typeLine(2, 'Upper', '35.00');
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    typeLine(3, 'Box', '120.00');
    fireEvent.change(screen.getByRole('combobox', { name: 'Section back ticket type' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      `PATCH ${PATH}`,
      `POST ${PATH}/tiers`,
      `PATCH ${PATH}/tiers/t-bal`,
      `PUT ${PATH}/seating`,
    ]);
    expect(writes[0].body).toMatchObject({ basePrice: '35.00' });
    expect(writes[0].body).not.toHaveProperty('totalTicketCapacity');
    expect(writes[1].body).toEqual({ name: 'Box', price: '120.00' });
    expect(writes[2].body).toEqual({ name: 'Upper', price: '35.00' });
    expect(writes[3].body).toEqual({
      reservedSeating: true,
      sections: [
        { sectionId: 's-front', tierId: 't-floor' },
        { sectionId: 's-middle', tierId: 't-bal' },
        { sectionId: 's-back', tierId: 't-box' },
      ],
    });
  });

  it("shows the Backend's reason for a refused change and keeps the form", async () => {
    const message = 'Section back has sold seats, so it stays in its tier.';
    stubApi(
      routes({
        [`PATCH ${PATH}`]: json(SEATED),
        [`PUT ${PATH}/seating`]: json({ error: { code: 'EVENT_HAS_ORDERS', message } }, 409),
      }),
    );
    at(`${PATH}/edit`, '/events/:id/edit');
    await typesLoaded();

    fireEvent.change(screen.getByRole('combobox', { name: 'Section back ticket type' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('combobox', { name: 'Section back ticket type' })).toHaveValue('0');
  });
});
