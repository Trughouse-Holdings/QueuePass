import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';
import { lockReason, MSG, repeatedTypeNameMessage } from '../src/pages/event-form-checks';
import { setLocalDateTime } from './helpers/event-times';

/**
 * Spec 035 (T006; FR-001 to FR-016, SC-002, SC-003, SC-006, research R11): three sections, tickets
 * only after a venue is chosen, live totals, preview and server errors beside the field, sold
 * locks on edit, and one setup PATCH.
 */
afterEach(() => vi.unstubAllGlobals());

const PLAIN = { ...VENUE, id: 'v-plain', name: 'Plain Hall', seatingCapacity: 500 };
const SEATED = { ...VENUE, seatingCapacity: 30 };
const LAYOUT = {
  locationId: VENUE.id,
  totalSeats: 30,
  sections: [
    { id: 's-front', name: 'front', rows: 1, seatsPerRow: 10 },
    { id: 's-middle', name: 'middle', rows: 1, seatsPerRow: 10 },
    { id: 's-back', name: 'back', rows: 1, seatsPerRow: 10 },
  ],
};
const NAME_TAKEN = repeatedTypeNameMessage(1, 'floor', 0, 'Floor');
const PATH = `/events/${EVENT.id}`;

const at = (path: string, route: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<EventForm />} />
        <Route path="/events/:id" element={<p>Event page</p>} />
      </Routes>
    </MemoryRouter>,
  );

const typeLine = (n: number, name: string, price: string, quantity?: string) => {
  fireEvent.change(screen.getByLabelText(`Ticket type ${n} name`), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(`Ticket type ${n} price`), { target: { value: price } });
  if (quantity !== undefined) {
    fireEvent.change(screen.getByLabelText(`Ticket type ${n} quantity`), {
      target: { value: quantity },
    });
  }
};

const schedule = () => fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

const writes = (api: ReturnType<typeof stubApi>) => api.calls.filter((c) => c.method !== 'GET');

async function chooseSeatedVenue() {
  fireEvent.change(await screen.findByLabelText('Event name'), { target: { value: 'Full House' } });
  await screen.findByRole('option', { name: /Yum Center/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
  setLocalDateTime('Starts', '2030-05-01T18:00');
  setLocalDateTime('Ends', '2030-05-01T21:00');
  await screen.findByRole('group', { name: 'Tickets and seating' });
}

describe('Schedule event (FR-001 to FR-012, SC-002, SC-003, SC-006)', () => {
  const createRoutes = (extra: object = {}) => ({
    'GET /locations': json([SEATED, PLAIN]),
    [`GET /locations/${VENUE.id}/layout`]: json(LAYOUT),
    'GET /locations/v-plain/layout': json({ locationId: 'v-plain', totalSeats: 0, sections: [] }),
    ...extra,
  });

  it('hides tickets and seating until a venue is chosen, then shows the live total', async () => {
    stubApi(createRoutes());
    at('/events/new', '/events/new');

    expect(await screen.findByRole('heading', { level: 1, name: 'Schedule event' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Venue and times' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tickets and seating' })).toBeNull();
    expect(screen.queryByTestId('seat-total')).toBeNull();

    await screen.findByRole('option', { name: /Yum Center/ });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
    const tickets = await screen.findByRole('group', { name: 'Tickets and seating' });
    expect(tickets).toBeInTheDocument();
    expect(screen.getByTestId('seat-total')).toHaveTextContent(
      '30 of 30 seats assigned All 30 seats are assigned.',
    );
  });

  it('shows an empty name beside the field, sends nothing, and focuses the name', async () => {
    const api = stubApi(createRoutes());
    at('/events/new', '/events/new');
    await chooseSeatedVenue();
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: '' } });
    schedule();

    expect(await screen.findByTestId('name-error')).toHaveTextContent(MSG.name);
    expect(screen.getByLabelText('Event name')).toHaveAttribute('aria-invalid', 'true');
    await vi.waitFor(() => expect(screen.getByLabelText('Event name')).toHaveFocus());
    expect(writes(api)).toEqual([]);
  });

  it('shows a repeated type name beside type 2 and sends nothing', async () => {
    const api = stubApi(createRoutes());
    at('/events/new', '/events/new');
    await chooseSeatedVenue();
    typeLine(1, 'Floor', '80.00');
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    typeLine(2, 'floor', '60.00');
    schedule();

    expect(await screen.findByTestId('type-2-error')).toHaveTextContent(NAME_TAKEN);
    expect(screen.getByLabelText('Ticket type 2 name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(writes(api)).toEqual([]);
  });

  it('places a server refusal that names tiers.1.name beside that field, focuses it, and has no top banner', async () => {
    const api = stubApi(
      createRoutes({
        'POST /events': json(
          {
            error: {
              code: 'TIER_NAME_TAKEN',
              message: NAME_TAKEN,
              details: { field: 'tiers.1.name' },
            },
          },
          409,
        ),
      }),
    );
    at('/events/new', '/events/new');
    await chooseSeatedVenue();
    typeLine(1, 'Floor', '80.00');
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    typeLine(2, 'Balcony', '60.00');
    fireEvent.change(screen.getByRole('combobox', { name: 'Section middle ticket type' }), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Section back ticket type' }), {
      target: { value: '1' },
    });
    schedule();

    expect(await screen.findByTestId('type-2-error')).toHaveTextContent(NAME_TAKEN);
    expect(screen.getByLabelText('Ticket type 2 name')).toHaveAttribute('aria-invalid', 'true');
    await vi.waitFor(() => expect(screen.getByLabelText('Ticket type 2 name')).toHaveFocus());
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(writes(api).map((c) => `${c.method} ${c.path}`)).toEqual(['POST /events']);
  });

  it('shows a scheduling conflict with the times, not at the top of the page', async () => {
    stubApi(
      createRoutes({
        'POST /events': json(
          {
            error: {
              code: 'SCHEDULING_CONFLICT',
              message:
                "This venue is already committed from 22:00 to 01:00 UTC by 'Season Opener'. " +
                'Events at the same venue must be at least 60 minutes apart.',
              details: {
                bufferMinutes: 60,
                conflictingEvent: {
                  id: '22222222-2222-4222-8222-222222222222',
                  name: 'Season Opener',
                  startsAt: '2030-05-01T22:00:00.000Z',
                  endsAt: '2030-05-02T01:00:00.000Z',
                },
              },
            },
          },
          409,
        ),
      }),
    );
    at('/events/new', '/events/new');
    await chooseSeatedVenue();
    typeLine(1, 'Floor', '80.00');
    schedule();

    const times = screen.getByRole('group', { name: 'Venue and times' });
    const banner = await screen.findByTestId('error-banner');
    expect(times).toContainElement(banner);
    expect(banner).toHaveAttribute('data-code', 'SCHEDULING_CONFLICT');
    expect(within(times).getByTestId('conflict-detail')).toHaveTextContent('Season Opener');
  });
});

describe('Edit event (FR-013, FR-014, FR-016, US5)', () => {
  const seatedEvent = { ...EVENT, reservedSeating: true, totalTicketCapacity: 30 };
  const tier = (id: string, name: string, price: string, quantity: number) => ({
    id,
    eventId: EVENT.id,
    name,
    price,
    quantity,
    createdAt: EVENT.createdAt,
    updatedAt: EVENT.updatedAt,
  });

  const editRoutes = (extra: object = {}) => ({
    'GET /locations': json([SEATED]),
    [`GET ${PATH}`]: json(seatedEvent),
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
          sold: 3,
          taken: [],
          reserved: [],
        },
        {
          sectionId: 's-middle',
          name: 'middle',
          rows: 1,
          seatsPerRow: 10,
          tierId: 't-bal',
          sold: 0,
          taken: [],
          reserved: [],
        },
        {
          sectionId: 's-back',
          name: 'back',
          rows: 1,
          seatsPerRow: 10,
          tierId: 't-bal',
          sold: 0,
          taken: [],
          reserved: [],
        },
      ],
    }),
    [`GET ${PATH}/availability`]: json({
      eventId: EVENT.id,
      ticketsLeft: 27,
      salesClosed: null,
      tiers: [
        { tierId: 't-floor', ticketsLeft: 7 },
        { tierId: 't-bal', ticketsLeft: 20 },
      ],
    }),
    ...extra,
  });

  it('locks reserved seating, a sold section, and Remove on a type with sales, each with the reason', async () => {
    stubApi(editRoutes());
    at(`${PATH}/edit`, '/events/:id/edit');

    await vi.waitFor(() =>
      expect(screen.getByLabelText('Ticket type 2 name')).toHaveValue('Balcony'),
    );
    expect(screen.getByLabelText('Reserved seating')).toBeDisabled();
    expect(screen.getByLabelText('General admission')).toBeDisabled();
    expect(screen.getByText(lockReason.seating)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Section front ticket type' })).toBeDisabled();
    expect(screen.getByText(lockReason.section)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove ticket type 1' })).toBeDisabled();
    expect(screen.getByText(lockReason.quantity(3))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove ticket type 2' })).not.toBeDisabled();
  });

  it('sends one PATCH /events/{id} with reservedSeating, tiers, and each existing type id', async () => {
    const api = stubApi(editRoutes({ [`PATCH ${PATH}`]: json(seatedEvent) }));
    at(`${PATH}/edit`, '/events/:id/edit');
    await vi.waitFor(() =>
      expect(screen.getByLabelText('Ticket type 2 name')).toHaveValue('Balcony'),
    );

    fireEvent.change(screen.getByLabelText('Ticket type 2 price'), { target: { value: '35.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(writes(api).map((c) => `${c.method} ${c.path}`)).toEqual([`PATCH ${PATH}`]);
    expect(writes(api)[0].body).toMatchObject({
      reservedSeating: true,
      tiers: [
        { id: 't-floor', name: 'Floor', price: '80.00', sectionIds: ['s-front'] },
        { id: 't-bal', name: 'Balcony', price: '35.00', sectionIds: ['s-middle', 's-back'] },
      ],
    });
  });
});
