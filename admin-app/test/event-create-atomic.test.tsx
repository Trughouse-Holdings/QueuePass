import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '@queuepass/shared/web';
import { EventForm } from '../src/pages/EventForm';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';
import { json, stubApi } from './helpers/api-stub';
import { pngFile, savedImage } from './helpers/images';
import { EVENT, VENUE } from './fixtures-005';

/**
 * Spec 031 (FR-008 to FR-012, SC-003, SC-004; research R5, R11): Schedule event sends the event,
 * its ticket types, and its seating in one request; a refusal keeps every value and shows beside
 * the ticket type or group it names; no answer says so.
 */
afterEach(() => vi.unstubAllGlobals());

const ID = EVENT.id;
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
    [`GET /locations/${VENUE.id}/layout`]: json(LAYOUT),
    'GET /locations/v-plain/layout': json({ locationId: 'v-plain', totalSeats: 0, sections: [] }),
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
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-05-01T18:00' } });
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-05-01T21:00' } });
  await screen.findByRole('group', { name: 'Ticket types' });
  typeLine(1, 'Floor', '80.00', '300');
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
  typeLine(2, 'floor', ' 60.00 ', '200');
}

async function fillSeated() {
  fireEvent.change(await screen.findByLabelText('Event name'), {
    target: { value: 'Season Opener' },
  });
  await screen.findByRole('option', { name: /Plain Hall/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-05-01T18:00' } });
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-05-01T21:00' } });
  await screen.findByRole('group', { name: 'Tickets and seating' });
  typeLine(1, 'Front', '120.00');
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
  typeLine(2, 'Standard', '70.00');
  fireEvent.change(screen.getByRole('combobox', { name: 'Section middle ticket type' }), {
    target: { value: '1' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Section back ticket type' }), {
    target: { value: '' },
  });
}

const choosePicture = () =>
  fireEvent.change(screen.getByLabelText('Add images'), { target: { files: [pngFile('a.png')] } });
const pictures = () =>
  within(screen.getByRole('group', { name: 'Images' })).queryAllByRole('listitem');
const schedule = () => fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));
const banner = () => screen.findByTestId('error-banner');

/** The general-admission form's values, all still there. */
const expectGeneralKept = () => {
  expect(screen.getByLabelText('Event name')).toHaveValue('Season Opener');
  expect(screen.getByLabelText('Venue')).toHaveValue('v-plain');
  expect(screen.getByLabelText('Starts')).toHaveValue('2030-05-01T18:00');
  expect(screen.getByLabelText('Ends')).toHaveValue('2030-05-01T21:00');
  expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('Floor');
  expect(screen.getByLabelText('Ticket type 2 name')).toHaveValue('floor');
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

  it('sends reserved seating and each type’s sections from the selects', async () => {
    const api = backend(json({ ...EVENT, reservedSeating: true, totalTicketCapacity: 30 }, 201));
    renderNew();
    await fillSeated();
    schedule();

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(writes(api)).toEqual(['POST /events']);
    const body = api.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body.reservedSeating).toBe(true);
    expect(body).not.toHaveProperty('totalTicketCapacity');
    expect(body.tiers).toEqual([
      { name: 'Front', price: '120.00', sectionIds: ['s-front'] },
      { name: 'Standard', price: '70.00', sectionIds: ['s-middle'] },
    ]);
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
    choosePicture();
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    schedule();

    expect(await banner()).toHaveTextContent(NAME_TAKEN);
    const name2 = screen.getByLabelText('Ticket type 2 name');
    expect(name2).toHaveAttribute('aria-invalid', 'true');
    expect(name2).toHaveAccessibleDescription(NAME_TAKEN);
    const hint = document.getElementById(name2.getAttribute('aria-describedby')!)!;
    expect(hint).toHaveAttribute('role', 'alert');
    expect(hint).toHaveClass('field__hint');
    expect(screen.getByLabelText('Ticket type 1 name')).not.toHaveAttribute('aria-invalid');
    expectGeneralKept();
    expect(writes(api)).toEqual(['POST /events']);
    expect(document.body).not.toHaveTextContent('Seating setup not finished');
  });

  it('shows a refused section beside ticket type 1’s seats line', async () => {
    const message =
      "tiers.0.sectionIds lists a section that is not in Yum Center's seating layout. Reload the form to see its sections.";
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

    expect(await banner()).toHaveTextContent(message);
    const line = screen.getByTestId('seats-1');
    expect(line).toHaveTextContent('Front: 10 seats');
    expect(within(line).getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByTestId('seats-2')).not.toHaveTextContent(message);
    expect(screen.getByLabelText('Ticket type 2 name')).toHaveValue('Standard');
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

    await banner();
    const group = screen.getByRole('group', { name: 'Ticket types' });
    expect(within(group).getByTestId('tiers-error')).toHaveTextContent(message);
    expect(screen.getByTestId('tiers-error')).toHaveAttribute('role', 'alert');
  });

  it('clears them when scheduling again; a 201 then uploads the picture and opens the event', async () => {
    const api = backend([
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
      () => new Promise<Response>(() => {}),
    ]);
    renderNew();
    await fillGeneral();
    choosePicture();
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    schedule();
    await banner();
    expect(screen.getByLabelText('Ticket type 2 name')).toHaveAttribute('aria-invalid', 'true');

    // The second answer never comes: the messages are already gone.
    typeLine(2, 'Balcony', '60.00', '200');
    schedule();
    await vi.waitFor(() => expect(api.count('POST', '/events')).toBe(2));
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(screen.getByLabelText('Ticket type 2 name')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(NAME_TAKEN)).toBeNull();
  });

  it('after a refusal, a fixed schedule is sent once more and opens the event', async () => {
    const api = backend([
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
      json(EVENT, 201),
    ]);
    renderNew();
    await fillGeneral();
    choosePicture();
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    schedule();
    await banner();
    typeLine(2, 'Balcony', '60.00', '200');
    schedule();

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(writes(api)).toEqual(['POST /events', 'POST /events', `POST /events/${ID}/images`]);
  });

  it('shows a database-backstop name refusal (no field) in the banner only', async () => {
    const message = 'Another tier of this event already has that name';
    backend(json({ error: { code: 'TIER_NAME_TAKEN', message } }, 409));
    renderNew();
    await fillGeneral();
    schedule();

    expect(await banner()).toHaveTextContent(message);
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

    expect(await banner()).toHaveTextContent('An unexpected error occurred.');
    expect(screen.queryByTestId('no-answer')).toBeNull();
  });
});
