import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import type { SeatingLayout } from '@queuepass/shared';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';

/**
 * Spec 016 US3 (FR-008, FR-011; research R7): admins set, change, and clear the per-customer
 * ticket limit in the event form, and see it on the event page.
 */
afterEach(() => vi.unstubAllGlobals());

const NO_LAYOUT: SeatingLayout = { locationId: VENUE.id, totalSeats: 0, sections: [] };
const LAYOUT = {
  locationId: VENUE.id,
  totalSeats: 30,
  sections: [{ id: 's-a', name: 'A', rows: 3, seatsPerRow: 10 }],
};
const SMALL = { ...VENUE, seatingCapacity: 50 };
const LIMITED = { ...EVENT, maxTicketsPerCustomer: 4 };
const tierReply = json(
  {
    id: 't-gen',
    eventId: EVENT.id,
    name: 'General',
    price: '10.00',
    quantity: 10,
    createdAt: EVENT.createdAt,
    updatedAt: EVENT.updatedAt,
  },
  201,
);

const at = (path: string, route: string, element: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
        <Route path="/events/:id" element={<p>Event page</p>} />
      </Routes>
    </MemoryRouter>,
  );

const newEventRoutes = (layout = NO_LAYOUT) => ({
  'GET /locations': json([SMALL]),
  [`GET /locations/${VENUE.id}/layout`]: json(layout),
  'POST /events': json(EVENT, 201),
  [`POST /events/${EVENT.id}/tiers`]: tierReply,
  [`PUT /events/${EVENT.id}/seating`]: json({}),
});

/** Fills a new general-admission event at the 50-seat venue. */
const fillNew = async ({ total = '', reserved = false } = {}) => {
  fireEvent.change(await screen.findByLabelText('Event name'), { target: { value: 'Opener' } });
  await screen.findByRole('option', { name: /Yum Center/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-05-01T18:00' } });
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-05-01T21:00' } });
  if (reserved) await screen.findByLabelText('Reserved seating');
  fireEvent.change(screen.getByLabelText('Ticket type 1 name'), { target: { value: 'General' } });
  fireEvent.change(screen.getByLabelText('Ticket type 1 price'), { target: { value: '10.00' } });
  if (!reserved) {
    fireEvent.change(screen.getByLabelText('Ticket type 1 quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Total tickets'), { target: { value: total } });
  }
};
const limitField = () => screen.getByLabelText('Tickets per customer');
const setLimit = (value: string) => fireEvent.change(limitField(), { target: { value } });
const submit = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const refusal = (n: number) =>
  `Tickets per customer must be a whole number from 1 to ${n}, or blank for no limit.`;

describe('event form: Tickets per customer', () => {
  it('shows the field with its hint', async () => {
    stubApi(newEventRoutes());
    at('/events/new', '/events/new', <EventForm />);
    expect(await screen.findByLabelText('Tickets per customer')).toHaveAttribute('min', '1');
    expect(screen.getByText('Leave blank for no limit.')).toBeInTheDocument();
  });

  it('sends the number on create when one is entered', async () => {
    const api = stubApi(newEventRoutes());
    at('/events/new', '/events/new', <EventForm />);
    await fillNew({ total: '40' });
    setLimit('4');
    submit(/Schedule event/);

    await vi.waitFor(() => expect(api.count('POST', '/events')).toBe(1));
    expect(api.calls.find((c) => c.path === '/events')?.body).toMatchObject({
      totalTicketCapacity: 40,
      maxTicketsPerCustomer: 4,
    });
  });

  it('leaves it out on create when blank', async () => {
    const api = stubApi(newEventRoutes());
    at('/events/new', '/events/new', <EventForm />);
    await fillNew();
    submit(/Schedule event/);

    await vi.waitFor(() => expect(api.count('POST', '/events')).toBe(1));
    expect(api.calls.find((c) => c.path === '/events')?.body).not.toHaveProperty(
      'maxTicketsPerCustomer',
    );
  });

  it('prefills it on edit, and sends null when cleared', async () => {
    const api = stubApi({
      'GET /locations': json([VENUE]),
      [`GET /events/${EVENT.id}`]: json(LIMITED),
      [`GET /events/${EVENT.id}/tiers`]: json([]),
      [`PATCH /events/${EVENT.id}`]: json(EVENT),
    });
    at(`/events/${EVENT.id}/edit`, '/events/:id/edit', <EventForm />);

    await vi.waitFor(() => expect(limitField()).toHaveValue(4));
    setLimit('');
    fireEvent.change(screen.getByLabelText('Ticket type 1 name'), { target: { value: 'General' } });
    fireEvent.change(screen.getByLabelText('Ticket type 1 price'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByLabelText('Ticket type 1 quantity'), { target: { value: '10' } });
    submit(/Save changes/);

    await vi.waitFor(() => expect(api.count('PATCH', `/events/${EVENT.id}`)).toBe(1));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toHaveProperty(
      'maxTicketsPerCustomer',
      null,
    );
  });

  it('sends a limit above the stored capacity after turning reserved seating on', async () => {
    const api = stubApi({
      'GET /locations': json([VENUE]),
      [`GET /events/${EVENT.id}`]: json(EVENT),
      [`GET /events/${EVENT.id}/tiers`]: json([
        {
          id: 't-gen',
          eventId: EVENT.id,
          name: 'General',
          price: '10.00',
          quantity: 10,
          createdAt: EVENT.createdAt,
          updatedAt: EVENT.updatedAt,
        },
      ]),
      [`GET /events/${EVENT.id}/seats`]: json({
        eventId: EVENT.id,
        reservedSeating: false,
        sections: [
          {
            sectionId: 's-a',
            name: 'A',
            rows: 15,
            seatsPerRow: 10,
            tierId: null,
            sold: 0,
            taken: [],
            reserved: [],
          },
        ],
      }),
      [`PATCH /events/${EVENT.id}`]: json(EVENT),
      [`PUT /events/${EVENT.id}/seating`]: json({}),
    });
    at(`/events/${EVENT.id}/edit`, '/events/:id/edit', <EventForm />);

    fireEvent.click(await screen.findByLabelText('Reserved seating'));
    setLimit('120');
    submit(/Save changes/);

    await vi.waitFor(() => expect(api.count('PATCH', `/events/${EVENT.id}`)).toBe(2));
    const writes = api.calls.filter((c) => c.method !== 'GET').map((c) => c.method);
    expect(writes.slice(0, 3)).toEqual(['PATCH', 'PUT', 'PATCH']);
    const [details, limit] = api.calls.filter((c) => c.method === 'PATCH');
    expect(details.body).not.toHaveProperty('maxTicketsPerCustomer');
    expect(limit.body).toEqual({ maxTicketsPerCustomer: 120 });
  });

  describe('refuses a value out of range before sending, keeping the other values', () => {
    it.each(['0', '2.5', '41'])('%s against the typed Total tickets', async (value) => {
      const api = stubApi(newEventRoutes());
      at('/events/new', '/events/new', <EventForm />);
      await fillNew({ total: '40' });
      setLimit(value);
      submit(/Schedule event/);

      expect(await screen.findByText(refusal(40))).toBeInTheDocument();
      expect(api.count('POST', '/events')).toBe(0);
      expect(screen.getByLabelText('Event name')).toHaveValue('Opener');
      expect(screen.getByLabelText('Total tickets')).toHaveValue(40);
    });

    it("against the venue's capacity when Total tickets is blank", async () => {
      const api = stubApi(newEventRoutes());
      at('/events/new', '/events/new', <EventForm />);
      await fillNew();
      setLimit('51');
      submit(/Schedule event/);

      expect(await screen.findByText(refusal(50))).toBeInTheDocument();
      expect(api.count('POST', '/events')).toBe(0);
    });

    it('against the layout total for reserved seating', async () => {
      const api = stubApi(newEventRoutes(LAYOUT));
      at('/events/new', '/events/new', <EventForm />);
      await fillNew({ reserved: true });
      setLimit('31');
      submit(/Schedule event/);

      expect(await screen.findByText(refusal(30))).toBeInTheDocument();
      expect(api.count('POST', '/events')).toBe(0);

      setLimit('30');
      submit(/Schedule event/);
      await vi.waitFor(() => expect(api.count('POST', '/events')).toBe(1));
      expect(api.calls.find((c) => c.path === '/events')?.body).toMatchObject({
        maxTicketsPerCustomer: 30,
      });
    });
  });

  it("shows the Backend's 400 in the error banner", async () => {
    stubApi({
      ...newEventRoutes(),
      'POST /events': json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: {
              fields: [
                "maxTicketsPerCustomer must be from 1 to the event's ticket capacity (40), or empty for no limit",
              ],
            },
          },
        },
        400,
      ),
    });
    at('/events/new', '/events/new', <EventForm />);
    await fillNew({ total: '40' });
    setLimit('4');
    submit(/Schedule event/);

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveTextContent(/maxTicketsPerCustomer must be from 1/);
    expect(limitField()).toHaveValue(4);
  });
});

describe('event page: Per customer', () => {
  const page = (event: object) => {
    stubApi({
      [`GET /events/${EVENT.id}`]: json(event),
      [`GET /events/${EVENT.id}/tiers`]: json([]),
    });
    render(
      <MemoryRouter initialEntries={[`/events/${EVENT.id}`]}>
        <Routes>
          <Route path="/events/:id" element={<EventDetail />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('shows the limit', async () => {
    page(LIMITED);
    const term = await screen.findByText('Per customer');
    expect(term.nextElementSibling).toHaveTextContent('4 tickets');
  });

  it('shows No limit without one, or when the field is missing', async () => {
    page(EVENT);
    expect((await screen.findByText('Per customer')).nextElementSibling).toHaveTextContent(
      'No limit',
    );
  });
});
