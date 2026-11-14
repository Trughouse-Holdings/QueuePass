import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';
import { CLUB_SUMMARY, layoutRoutes } from './fixtures-038';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';
import { setLocalDateTime } from './helpers/event-times';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 016 US3 (FR-008, FR-011; research R7): admins set, change, and clear the per-customer
 * ticket limit in the event form, and see it on the event page.
 */
afterEach(() => vi.unstubAllGlobals());

const SMALL = { ...VENUE, seatingCapacity: 50 };
const LIMITED = { ...EVENT, maxTicketsPerCustomer: 4 };

const at = (path: string, route: string, element: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
        <Route path="/events/:id" element={<p>Event page</p>} />
      </Routes>
    </MemoryRouter>,
  );

/** Spec 038: with `seated`, the venue has layouts (the 12-seat Club among them). */
const newEventRoutes = (seated = false) => ({
  'GET /locations': json([SMALL]),
  ...layoutRoutes(),
  [`GET /locations/${VENUE.id}/layouts`]: json(seated ? [CLUB_SUMMARY] : []),
  // Spec 031 FR-008: the event, its ticket types, and its seating in one request.
  'POST /events': json(EVENT, 201),
});

/** Fills a new general-admission event at the 50-seat venue. */
const fillNew = async ({ total = '', reserved = false } = {}) => {
  fireEvent.change(await screen.findByLabelText('Event name'), { target: { value: 'Opener' } });
  await screen.findByRole('option', { name: /Yum Center/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
  setLocalDateTime('Starts', '2030-05-01T18:00');
  setLocalDateTime('Ends', '2030-05-01T21:00');
  if (reserved) {
    // Spec 038: the Club layout, 12 seats, one level priced.
    fireEvent.change(await screen.findByRole('combobox', { name: 'Seating' }), {
      target: { value: 'l-club' },
    });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Club seats price' }), {
      target: { value: '20.00' },
    });
    return;
  }
  await screen.findByLabelText('Ticket type 1 name');
  fireEvent.change(screen.getByLabelText('Ticket type 1 name'), { target: { value: 'General' } });
  fireEvent.change(screen.getByLabelText('Ticket type 1 price'), { target: { value: '10.00' } });
  fireEvent.change(screen.getByLabelText('Ticket type 1 quantity'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('Total tickets'), { target: { value: total } });
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
    // Issue #118: the ticket types are a separate request from the event.
    await screen.findByLabelText('Ticket type 1 name');
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

  it('sends a limit above the stored capacity after choosing a larger layout', async () => {
    const SMALL_EVENT = { ...EVENT, totalTicketCapacity: 10, layoutId: null, priceMax: null };
    const api = stubApi({
      'GET /locations': json([VENUE]),
      ...layoutRoutes(),
      [`GET /locations/${VENUE.id}/layouts`]: json([CLUB_SUMMARY]),
      [`GET /events/${EVENT.id}`]: json(SMALL_EVENT),
      [`GET /events/${EVENT.id}/tiers`]: json([]),
      [`PATCH /events/${EVENT.id}`]: json(SMALL_EVENT),
    });
    at(`/events/${EVENT.id}/edit`, '/events/:id/edit', <EventForm />);

    // Issue #118: the event (its limit, name, and times) and the ticket types load separately;
    // a limit typed before the event arrived would be overwritten by the stored one.
    await vi.waitFor(() => expect(screen.getByLabelText('Event name')).toHaveValue(EVENT.name));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Seating' }), {
      target: { value: 'l-club' },
    });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Club seats price' }), {
      target: { value: '20.00' },
    });
    setLimit('12');
    submit(/Save changes/);

    await vi.waitFor(() => expect(api.count('PATCH', `/events/${EVENT.id}`)).toBe(1));
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => c.method)).toEqual(['PATCH']);
    expect(writes[0].body).toMatchObject({ layoutId: 'l-club', maxTicketsPerCustomer: 12 });
  });

  describe('refuses a value out of range before sending, keeping the other values', () => {
    it.each(['0', '2.5', '41'])('%s against the typed Total tickets', async (value) => {
      const api = stubApi(newEventRoutes());
      at('/events/new', '/events/new', <EventForm />);
      await fillNew({ total: '40' });
      setLimit(value);
      submit(/Schedule event/);

      expect(await screen.findByTestId('maxTicketsPerCustomer-error')).toHaveTextContent(
        refusal(40),
      );
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

      expect(await screen.findByTestId('maxTicketsPerCustomer-error')).toHaveTextContent(
        refusal(50),
      );
      expect(api.count('POST', '/events')).toBe(0);
    });

    it("against a layout's seats on sale for reserved seating", async () => {
      const api = stubApi(newEventRoutes(true));
      at('/events/new', '/events/new', <EventForm />);
      await fillNew({ reserved: true });
      setLimit('13');
      submit(/Schedule event/);

      expect(await screen.findByTestId('maxTicketsPerCustomer-error')).toHaveTextContent(
        refusal(12),
      );
      expect(api.count('POST', '/events')).toBe(0);

      setLimit('12');
      submit(/Schedule event/);
      await vi.waitFor(() => expect(api.count('POST', '/events')).toBe(1));
      expect(api.calls.find((c) => c.path === '/events')?.body).toMatchObject({
        maxTicketsPerCustomer: 12,
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

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('maxTicketsPerCustomer-error')).toHaveTextContent(
      /maxTicketsPerCustomer must be from 1/,
    );
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
