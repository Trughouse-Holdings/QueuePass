import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '@queuepass/shared/web';
import { EventForm } from '../src/pages/EventForm';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';
import { json, stubApi } from './helpers/api-stub';
import { pngFile, savedImage } from './helpers/images';
import { EVENT, VENUE } from './fixtures-005';
import { layoutRoutes } from './fixtures-038';
import { expectLocalDateTime, setLocalDateTime } from './helpers/event-times';

/**
 * Spec 031 (FR-008 to FR-012, SC-003, SC-004; research R5, R11): Schedule event sends the event,
 * its ticket types, and its seating in one request; a refusal keeps every value and shows beside
 * the ticket type or group it names; no answer says so.
 */
afterEach(() => vi.unstubAllGlobals());

const ID = EVENT.id;
const PLAIN = { ...VENUE, id: 'v-plain', name: 'Plain Hall', seatingCapacity: 500 };
const SEATED = { ...VENUE, seatingCapacity: 70 };
const NO_ANSWER =
  'No answer from QueuePass, so the event may or may not have been scheduled. Check the Events ' +
  'list before scheduling it again.';
const NAME_TAKEN =
  "Ticket type 2, 'floor', has the same name as ticket type 1, 'Floor'. Give each ticket type its own name.";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const renderNew = () =>
  render(
    <AuthProvider
      userManager={fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }))}
    >
      <MemoryRouter initialEntries={['/events/new']}>
        <Routes>
          <Route path="/events/new" element={<EventForm />} />
          <Route path="/events/:id" element={<p>Event page</p>} />
          <Route path="/events" element={<p>Event list</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </AuthProvider>,
  );

type Reply = Response | (() => Response | Promise<Response>) | 'network-error';

const backend = (createReply: Reply | Reply[]) => {
  const replies = Array.isArray(createReply) ? [...createReply] : null;
  return stubApi({
    'GET /locations': json([SEATED, PLAIN]),
    ...layoutRoutes(),
    'GET /locations/v-plain/layouts': json([]),
    'POST /events': replies
      ? () => {
          const next = replies.shift()!;
          if (next === 'network-error') throw new TypeError('Failed to fetch');
          return typeof next === 'function' ? next() : next;
        }
      : (createReply as Reply),
    [`POST /events/${ID}/images`]: () => json(savedImage('img-1', 1), 201),
  });
};

const writes = (api: ReturnType<typeof stubApi>) =>
  api.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

const typeLine = (n: number, name: string, price: string, quantity?: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: `Ticket type ${n} name` }), {
    target: { value: name },
  });
  fireEvent.change(screen.getByRole('textbox', { name: `Ticket type ${n} price` }), {
    target: { value: price },
  });
  if (quantity !== undefined) {
    fireEvent.change(screen.getByLabelText(`Ticket type ${n} quantity`), {
      target: { value: quantity },
    });
  }
};

async function fillGeneral() {
  fireEvent.change(await screen.findByLabelText('Event name'), {
    target: { value: 'Season Opener' },
  });
  await screen.findByRole('option', { name: /Plain Hall/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'v-plain' } });
  setLocalDateTime('Starts', '2030-05-01T18:00');
  setLocalDateTime('Ends', '2030-05-01T21:00');
  await screen.findByRole('group', { name: 'Tickets and seating' });
  typeLine(1, 'Floor', '80.00', '300');
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
  typeLine(2, 'Balcony', ' 60.00 ', '200');
}

async function fillSeated() {
  fireEvent.change(await screen.findByLabelText('Event name'), {
    target: { value: 'Season Opener' },
  });
  await screen.findByRole('option', { name: /Plain Hall/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
  setLocalDateTime('Starts', '2030-05-01T18:00');
  setLocalDateTime('Ends', '2030-05-01T21:00');
  // Spec 038: the venue's Club layout, its one level priced.
  fireEvent.change(await screen.findByRole('combobox', { name: 'Seating' }), {
    target: { value: 'l-club' },
  });
  fireEvent.change(await screen.findByRole('textbox', { name: 'Club seats price' }), {
    target: { value: '20.00' },
  });
}

const choosePicture = () =>
  fireEvent.change(screen.getByLabelText('Add images'), { target: { files: [pngFile('a.png')] } });
const pictures = () =>
  within(screen.getByRole('group', { name: 'Images' })).queryAllByRole('listitem');
const schedule = () => fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

/** The general-admission form's values, all still there. */
const expectGeneralKept = () => {
  expect(screen.getByLabelText('Event name')).toHaveValue('Season Opener');
  expect(screen.getByLabelText('Venue')).toHaveValue('v-plain');
  expectLocalDateTime('Starts', '2030-05-01T18:00');
  expectLocalDateTime('Ends', '2030-05-01T21:00');
  expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('Floor');
  expect(screen.getByLabelText('Ticket type 2 name')).toHaveValue('Balcony');
  expect(screen.getByLabelText('Ticket type 2 price')).toHaveValue(' 60.00 ');
  expect(screen.getByLabelText('Ticket type 2 quantity')).toHaveValue(200);
  expect(pictures()).toHaveLength(1);
  expect(screen.getByTestId('where')).toHaveTextContent('/events/new');
};

describe('one request (FR-008, SC-004)', () => {
  it('sends a general-admission schedule as one POST /events with its ticket types', async () => {
    const api = backend(json(EVENT, 201));
    renderNew();
    await fillGeneral();
    typeLine(2, 'Balcony', ' 60.00 ', '200');
    schedule();

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(writes(api)).toEqual(['POST /events']);
    const body = api.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body.tiers).toEqual([
      { name: 'Floor', price: '80.00', quantity: 300 },
      { name: 'Balcony', price: '60.00', quantity: 200 },
    ]);
    expect(body).not.toHaveProperty('reservedSeating');
    expect(JSON.stringify(body)).not.toContain('sectionIds');
    expect(body.basePrice).toBe('60.00');
  });

  it('sends a seated schedule with its layout, level prices and seats off sale', async () => {
    const api = backend(
      json({ ...EVENT, reservedSeating: true, layoutId: 'l-club', totalTicketCapacity: 12 }, 201),
    );
    renderNew();
    await fillSeated();
    schedule();

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(writes(api)).toEqual(['POST /events']);
    const body = api.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      layoutId: 'l-club',
      levelPrices: [{ levelId: 'l-club', price: '20.00' }],
      offSale: [],
    });
    for (const field of ['reservedSeating', 'totalTicketCapacity', 'tiers']) {
      expect(body).not.toHaveProperty(field);
    }
  });
});

describe('a refusal keeps every value and shows beside its field (FR-009, FR-010)', () => {
  it('shows a repeated name beside ticket type 2 and in the banner; sends nothing else', async () => {
    const api = backend(
      json(
        {
          error: {
            code: 'TIER_NAME_TAKEN',
            message: NAME_TAKEN,
            details: { field: 'tiers.1.name' },
          },
        },
        409,
      ),
    );
    renderNew();
    await fillGeneral();
    typeLine(2, 'floor', ' 60.00 ', '200');
    choosePicture();
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('type-2-error')).toHaveTextContent(NAME_TAKEN);
    const name2 = screen.getByLabelText('Ticket type 2 name');
    expect(name2).toHaveAttribute('aria-invalid', 'true');
    expect(name2).toHaveAccessibleDescription(NAME_TAKEN);
    const hint = document.getElementById(name2.getAttribute('aria-describedby')!)!;
    expect(hint).toHaveAttribute('role', 'alert');
    expect(hint).toHaveClass('field__hint');
    expect(screen.getByLabelText('Ticket type 1 name')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Ticket type 2 name')).toHaveValue('floor');
    expect(screen.getByLabelText('Event name')).toHaveValue('Season Opener');
    expect(writes(api)).toEqual([]);
    expect(document.body).not.toHaveTextContent('Seating setup not finished');
  });

  it('shows a refused seat beside the seats off sale', async () => {
    const message = 'offSale.0 names no seat of this layout';
    backend(
      json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: { fields: [message] },
          },
        },
        400,
      ),
    );
    renderNew();
    await fillSeated();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('offSale-error')).toHaveTextContent(message);
    expect(screen.getByRole('textbox', { name: 'Club seats price' })).toHaveValue('20.00');
  });

  it('shows ticket types over capacity beside the ticket types', async () => {
    const message = 'Season Opener has 400 tickets, but its ticket types add up to 500.';
    backend(
      json(
        {
          error: {
            code: 'CAPACITY_EXCEEDED',
            message,
            details: { field: 'tiers', totalTicketCapacity: 400, tierTotal: 500 },
          },
        },
        409,
      ),
    );
    renderNew();
    await fillGeneral();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    const group = await screen.findByRole('group', { name: 'Tickets and seating' });
    expect(within(group).getByTestId('tiers-error')).toHaveTextContent(message);
    expect(screen.getByTestId('tiers-error')).toHaveAttribute('role', 'alert');
  });

  it('clears them when scheduling again; a 201 then uploads the picture and opens the event', async () => {
    const api = backend([() => new Promise<Response>(() => {})]);
    renderNew();
    await fillGeneral();
    typeLine(2, 'floor', ' 60.00 ', '200');
    choosePicture();
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    schedule();
    expect(await screen.findByTestId('type-2-error')).toHaveTextContent(NAME_TAKEN);
    expect(screen.getByLabelText('Ticket type 2 name')).toHaveAttribute('aria-invalid', 'true');
    expect(api.count('POST', '/events')).toBe(0);

    // The first schedule is sent only after the preview is clear; the answer never comes.
    typeLine(2, 'Balcony', '60.00', '200');
    schedule();
    await vi.waitFor(() => expect(api.count('POST', '/events')).toBe(1));
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(screen.getByLabelText('Ticket type 2 name')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(NAME_TAKEN)).toBeNull();
  });

  it('after a refusal, a fixed schedule is sent once more and opens the event', async () => {
    const api = backend([json(EVENT, 201)]);
    renderNew();
    await fillGeneral();
    typeLine(2, 'floor', ' 60.00 ', '200');
    choosePicture();
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    schedule();
    expect(await screen.findByTestId('type-2-error')).toHaveTextContent(NAME_TAKEN);
    typeLine(2, 'Balcony', '60.00', '200');
    schedule();

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(writes(api)).toEqual(['POST /events', `POST /events/${ID}/images`]);
  });

  it('shows a database-backstop name refusal (no field) next to submit, not on a type', async () => {
    const message = 'Another tier of this event already has that name';
    backend(json({ error: { code: 'TIER_NAME_TAKEN', message } }, 409));
    renderNew();
    await fillGeneral();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('submit-error')).toHaveTextContent(message);
    expect(screen.getAllByText(message)).toHaveLength(1);
    for (const n of [1, 2]) {
      expect(screen.getByLabelText(`Ticket type ${n} name`)).not.toHaveAttribute('aria-invalid');
    }
  });
});

describe('no answer (FR-011)', () => {
  const expectNoAnswer = async () => {
    const alert = await screen.findByTestId('no-answer');
    expect(alert).toHaveTextContent(NO_ANSWER);
    expect(alert).toHaveAttribute('role', 'alert');
    expect(within(alert).getByRole('link', { name: 'Events list' })).toHaveAttribute(
      'href',
      '/events',
    );
  };

  it('says it cannot tell when the request fails to send, and keeps every value', async () => {
    const api = backend('network-error');
    renderNew();
    await fillGeneral();
    choosePicture();
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    schedule();

    await expectNoAnswer();
    expectGeneralKept();
    expect(writes(api)).toEqual(['POST /events']);
    expect(document.body).not.toHaveTextContent('Seating setup not finished');
  });

  it('treats a 502 without the envelope as no answer', async () => {
    backend(new Response('<html>Bad Gateway</html>', { status: 502 }));
    renderNew();
    await fillGeneral();
    choosePicture();
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    schedule();

    await expectNoAnswer();
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expectGeneralKept();
  });

  it('shows a 500 with the envelope as an error, as today', async () => {
    backend(
      json({ error: { code: 'VALIDATION_FAILED', message: 'An unexpected error occurred.' } }, 500),
    );
    renderNew();
    await fillGeneral();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('submit-error')).toHaveTextContent(
      'An unexpected error occurred.',
    );
    expect(screen.queryByTestId('no-answer')).toBeNull();
  });
});

/** Code review round 1 (S1, S2, S3): every place a path lands, each tied to its field. */
describe('each path lands beside its field, associated with it (FR-010)', () => {
  const refused = (fields: string[]) =>
    json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed.',
          details: { fields },
        },
      },
      400,
    );

  it('puts a malformed price on ticket type 2’s price input only', async () => {
    const entry =
      'tiers.1.price must be a non-negative decimal string with at most 2 decimal places';
    backend(refused([entry]));
    renderNew();
    await fillGeneral();
    schedule();

    const price2 = await screen.findByLabelText('Ticket type 2 price');
    await vi.waitFor(() => expect(price2).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(price2).toHaveAccessibleDescription(entry);
    expect(screen.getByLabelText('Ticket type 2 name')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Ticket type 2 quantity')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Ticket type 1 price')).not.toHaveAttribute('aria-invalid');
  });

  it('marks every input of a type with an unknown property', async () => {
    const entry = 'tiers.0.property colour should not exist';
    backend(refused([entry]));
    renderNew();
    await fillGeneral();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    for (const field of ['name', 'price', 'quantity']) {
      const input = screen.getByLabelText(`Ticket type 1 ${field}`);
      await vi.waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
      expect(input).toHaveAccessibleDescription(entry);
    }
    expect(screen.getByLabelText('Ticket type 2 name')).not.toHaveAttribute('aria-invalid');
  });

  it('puts an entry about the list itself beside the ticket types', async () => {
    const entry =
      'tiers.tiers must be a list of ticket types, each an object with a name and a price';
    backend(refused([entry]));
    renderNew();
    await fillGeneral();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('tiers-error')).toHaveTextContent(entry);
    expect(screen.queryByTestId('type-1-error')).toBeNull();
  });

  it('puts a capacity entry beside the ticket types group, which it describes', async () => {
    const entry = 'totalTicketCapacity must be a positive whole number';
    backend(refused([entry]));
    renderNew();
    await fillGeneral();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    const group = screen.getByRole('group', { name: 'Tickets and seating' });
    expect(await screen.findByTestId('seating-error')).toHaveTextContent(entry);
    expect(group).toHaveAccessibleDescription(entry);
  });

  it('puts a layout refusal beside the seating choice, which it describes', async () => {
    const entry = "layoutId must be one of the venue's layouts";
    backend(refused([entry]));
    renderNew();
    await fillSeated();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('layoutId-error')).toHaveTextContent(entry);
    const select = screen.getByRole('combobox', { name: 'Seating' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription(entry);
  });

  it('ties an off-sale entry to the seats off sale, which it describes', async () => {
    const entry = 'offSale.0.row must be a whole number of at least 1, and is required with seat';
    backend(refused([entry]));
    renderNew();
    await fillSeated();
    schedule();

    expect(screen.queryByTestId('error-banner')).toBeNull();
    const tool = screen.getByRole('group', { name: 'Seats off sale' });
    await vi.waitFor(() => expect(tool).toHaveAccessibleDescription(entry));
    expect(screen.getByRole('combobox', { name: 'Seating' })).not.toHaveAttribute('aria-invalid');
  });
});

/** Spec 035 FR-019: the Edit form places a refusal beside its field, like Schedule event. */
describe('editing places refusals beside their fields (FR-019)', () => {
  it('shows field hints on Edit when the refusal names them', async () => {
    const fields = [
      'totalTicketCapacity must be a positive whole number',
      'tiers.0.name must be between 1 and 100 characters',
    ];
    stubApi({
      'GET /locations': json([PLAIN]),
      [`GET /events/${ID}`]: json({ ...EVENT, locationId: 'v-plain', location: PLAIN }),
      [`GET /events/${ID}/tiers`]: json([
        {
          id: 't1',
          eventId: ID,
          name: 'Floor',
          price: '80.00',
          quantity: 10,
          createdAt: EVENT.createdAt,
          updatedAt: EVENT.updatedAt,
        },
      ]),
      [`PATCH /events/${ID}`]: json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: { fields },
          },
        },
        400,
      ),
    });
    render(
      <MemoryRouter initialEntries={[`/events/${ID}/edit`]}>
        <Routes>
          <Route path="/events/:id/edit" element={<EventForm />} />
        </Routes>
      </MemoryRouter>,
    );
    await vi.waitFor(() =>
      expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('Floor'),
    );
    await vi.waitFor(() => expect(screen.getByLabelText('Event name')).toHaveValue(EVENT.name));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('seating-error')).toHaveTextContent(fields[0]!);
    expect(screen.getByTestId('type-1-error')).toHaveTextContent(fields[1]!);
    expect(screen.getByLabelText('Ticket type 1 name')).toHaveAttribute('aria-invalid', 'true');
  });
});
