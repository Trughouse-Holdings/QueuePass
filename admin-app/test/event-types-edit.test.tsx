import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';
import { layoutRoutes } from './fixtures-038';
import { setLocalDateTime } from './helpers/event-times';

/**
 * Spec 008 US7 (FR-019; research R10): no base price; a general-admission event is priced by its
 * ticket types, and editing it changes them too. Spec 038 (FR-012): a seated event has none.
 */
afterEach(() => vi.unstubAllGlobals());

const PLAIN = { ...VENUE, id: 'v-plain', name: 'Plain Hall' };
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

/**
 * The edit form has loaded the event's ticket types and, issue #118, the event itself: they are
 * separate requests, and the event decides its seating (so whether ticket types show) and what Save
 * sends.
 */
const typesLoaded = () =>
  vi.waitFor(() => {
    expect(screen.getByLabelText('Ticket type 2 name')).toHaveValue('Balcony');
    expect(screen.getByLabelText('Event name')).toHaveValue(EVENT.name);
  });

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
    // Spec 031 FR-008: the ticket types go in the one POST /events.
    const api = stubApi({
      'GET /locations': json([PLAIN]),
      'GET /locations/v-plain/layouts': json([]),
      'POST /events': json({ ...EVENT, locationId: 'v-plain' }, 201),
    });
    at('/events/new', '/events/new');

    await screen.findByRole('option', { name: /Plain Hall/ });
    expect(screen.queryByLabelText('Base price')).toBeNull();
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fair' } });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'v-plain' } });
    setLocalDateTime('Starts', '2030-05-01T18:00');
    setLocalDateTime('Ends', '2030-05-01T21:00');
    await screen.findByLabelText('Ticket type 1 name');
    typeLine(1, 'Floor', '80.00', '100');
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    typeLine(2, 'Lawn', '25.00', '300');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /events']);
    expect(writes[0].body).toMatchObject({ basePrice: '25.00' });
    expect((writes[0].body as { tiers: unknown }).tiers).toEqual([
      { name: 'Floor', price: '80.00', quantity: 100 },
      { name: 'Lawn', price: '25.00', quantity: 300 },
    ]);
  });

  it('asks for a quantity on a general-admission ticket type', async () => {
    const api = stubApi({
      'GET /locations': json([PLAIN]),
      'GET /locations/v-plain/layouts': json([]),
    });
    at('/events/new', '/events/new');

    await screen.findByRole('option', { name: /Plain Hall/ });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'v-plain' } });
    await screen.findByLabelText('Ticket type 1 name');
    typeLine(1, 'Floor', '80.00');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByTestId('type-1-error')).toHaveTextContent(
      'Give this ticket type a quantity.',
    );
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe("editing an event: ticket types are general admission's (spec 038 FR-012)", () => {
  const GA = { ...EVENT, layoutId: null, priceMax: null, totalTicketCapacity: 30 };
  const PATH = `/events/${EVENT.id}`;
  const routes = (event: object = GA, extra: object = {}) => ({
    'GET /locations': json([VENUE]),
    ...layoutRoutes(),
    [`GET ${PATH}`]: json(event),
    [`GET ${PATH}/tiers`]: json([
      tier('t-floor', 'Floor', '80.00', 10),
      tier('t-bal', 'Balcony', '30.00', 20),
    ]),
    ...extra,
  });

  it('shows its ticket types with quantities, prefilled, and no base price', async () => {
    stubApi(routes());
    at(`${PATH}/edit`, '/events/:id/edit');

    await typesLoaded();
    expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('Floor');
    expect(screen.getByLabelText('Ticket type 2 price')).toHaveValue('30.00');
    expect(screen.getByLabelText('Ticket type 1 quantity')).toHaveValue(10);
    expect(screen.queryByLabelText('Base price')).toBeNull();
  });

  it('applies renamed, repriced, and new types in one PATCH, then opens the event', async () => {
    const api = stubApi(routes(GA, { [`PATCH ${PATH}`]: json(GA) }));
    at(`${PATH}/edit`, '/events/:id/edit');
    await typesLoaded();

    typeLine(2, 'Upper', '35.00', '15');
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    typeLine(3, 'Box', '120.00', '5');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([`PATCH ${PATH}`]);
    expect(writes[0].body).toMatchObject({
      basePrice: '35.00',
      tiers: [
        { id: 't-floor', name: 'Floor', price: '80.00', quantity: 10 },
        { id: 't-bal', name: 'Upper', price: '35.00', quantity: 15 },
        { name: 'Box', price: '120.00', quantity: 5 },
      ],
    });
    expect(writes[0].body).not.toHaveProperty('reservedSeating');
  });

  it('shows no ticket types for a seated event: it is priced by level', async () => {
    stubApi(
      routes(
        {
          ...EVENT,
          reservedSeating: true,
          layoutId: 'l-club',
          priceMax: '20.00',
          totalTicketCapacity: 12,
        },
        {
          [`GET ${PATH}/tiers`]: json([]),
          [`GET ${PATH}/seating`]: json({
            eventId: EVENT.id,
            layoutId: 'l-club',
            levels: [
              {
                levelId: 'l-club',
                name: 'Club seats',
                rank: 1,
                color: 'orange',
                seatCount: 12,
                seatsOnSale: 12,
                price: '20.00',
              },
            ],
            offSale: [],
            seatsOnSale: 12,
            seatsOffSale: 0,
          }),
        },
      ),
    );
    at(`${PATH}/edit`, '/events/:id/edit');

    expect(await screen.findByRole('textbox', { name: 'Club seats price' })).toHaveValue('20.00');
    expect(screen.queryByLabelText('Ticket type 1 name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add ticket type' })).toBeNull();
  });

  it("shows the Backend's reason for a refused change beside the ticket types and keeps the form", async () => {
    const message = 'Cannot remove the tier "Balcony": it has 2 orders.';
    stubApi(
      routes(GA, {
        [`PATCH ${PATH}`]: json(
          {
            error: { code: 'TIER_HAS_ORDERS', message, details: { field: 'tiers', orderCount: 2 } },
          },
          409,
        ),
      }),
    );
    at(`${PATH}/edit`, '/events/:id/edit');
    await typesLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Remove ticket type 2' }));
    fireEvent.change(screen.getByLabelText('Ticket type 1 quantity'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText('Ticket type 1 quantity')).toHaveValue(30);
  });
});
