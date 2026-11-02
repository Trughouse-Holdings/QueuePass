import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { doorsOpenRangeMessage } from '@queuepass/shared';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';

/**
 * Spec 025 US1 (FR-002 to FR-005, FR-007; research R4) (T008): the event form's Doors open field,
 * read in the venue's zone, prefilled at the start minus 1 hour and following the start until the
 * admin changes it, checked before anything is sent. Exact local values, so it holds whatever the
 * device's zone is.
 */
afterEach(() => vi.unstubAllGlobals());

const CENTRAL = {
  ...VENUE,
  id: 'v-central',
  name: 'Prairie Hall',
  timeZone: 'America/Chicago',
  timeZoneSource: 'ADMIN',
};
const NO_LAYOUT = { locationId: CENTRAL.id, totalSeats: 0, sections: [] };
const TIER = {
  id: 't1',
  eventId: EVENT.id,
  name: 'General',
  price: '45.00',
  quantity: 10,
  createdAt: EVENT.createdAt,
  updatedAt: EVENT.updatedAt,
};

function newForm(post: () => Response = () => json({ ...EVENT, locationId: CENTRAL.id }, 201)) {
  const api = stubApi({
    'GET /locations': json([CENTRAL]),
    [`GET /locations/${CENTRAL.id}/layout`]: json(NO_LAYOUT),
    'POST /events': post,
    [`POST /events/${EVENT.id}/tiers`]: json(TIER, 201),
  });
  render(
    <MemoryRouter initialEntries={['/events/new']}>
      <Routes>
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/:id" element={<p>Event page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return api;
}

// 7:00 PM CST on Nov 20, 2026, doors 90 minutes before (5:30 PM CST).
const STORED = {
  ...EVENT,
  locationId: CENTRAL.id,
  location: CENTRAL,
  startsAt: '2026-11-21T01:00:00.000Z',
  endsAt: '2026-11-21T04:00:00.000Z',
  doorsOpenAt: '2026-11-20T23:30:00.000Z',
  entryOpensAt: '2026-11-20T22:30:00.000Z',
};

function editForm() {
  const api = stubApi({
    'GET /locations': json([CENTRAL]),
    [`GET /events/${EVENT.id}`]: json(STORED),
    [`GET /events/${EVENT.id}/tiers`]: json([TIER]),
    [`GET /events/${EVENT.id}/seats`]: json({
      eventId: EVENT.id,
      reservedSeating: false,
      sections: [],
    }),
    [`PATCH /events/${EVENT.id}`]: json(STORED),
  });
  render(
    <MemoryRouter initialEntries={[`/events/${EVENT.id}/edit`]}>
      <Routes>
        <Route path="/events/:id/edit" element={<EventForm />} />
        <Route path="/events/:id" element={<p>Event page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return api;
}

const set = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const doors = () => screen.getByLabelText('Doors open');

async function fill(starts: string, ends: string) {
  await screen.findByRole('option', { name: /Prairie Hall/ });
  set('Event name', 'Fall Concert');
  set('Venue', CENTRAL.id);
  set('Starts', starts);
  set('Ends', ends);
  set('Ticket type 1 name', 'General');
  set('Ticket type 1 price', '45.00');
  set('Ticket type 1 quantity', '10');
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));
const posted = (api: ReturnType<typeof stubApi>) =>
  api.calls.filter((c) => c.method === 'POST' && c.path === '/events').map((c) => c.body);

// 7:00 PM CST on Nov 20, 2026 is 01:00Z on Nov 21.
const RANGE = doorsOpenRangeMessage('2026-11-21T01:00:00Z', 'America/Chicago');

describe('the Doors open field (FR-002, FR-003)', () => {
  it('is before Starts and empty, then follows the typed start 1 hour earlier', async () => {
    newForm();
    await screen.findByRole('option', { name: /Prairie Hall/ });
    set('Venue', CENTRAL.id);
    expect(doors()).toHaveValue('');
    expect(
      doors().compareDocumentPosition(screen.getByLabelText('Starts')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    set('Starts', '2026-11-20T19:00');
    expect(doors()).toHaveValue('2026-11-20T18:00');
    set('Starts', '2026-11-20T20:00');
    expect(doors()).toHaveValue('2026-11-20T19:00');
  });

  it('keeps what the admin typed when the start changes afterwards', async () => {
    newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Doors open', '2026-11-20T17:30');
    set('Starts', '2026-11-20T20:00');
    expect(doors()).toHaveValue('2026-11-20T17:30');
  });

  it('on edit shows the stored doors and follows the start with the stored 90-minute gap', async () => {
    editForm();
    await vi.waitFor(() => expect(doors()).toHaveValue('2026-11-20T17:30'));
    set('Starts', '2026-11-20T20:00');
    expect(doors()).toHaveValue('2026-11-20T18:30');
  });

  it('does not follow a start that is a repeated time not yet chosen, then follows the chosen one', async () => {
    newForm();
    await fill('2027-11-07T03:00', '2027-11-07T05:00');
    expect(doors()).toHaveValue('2027-11-07T02:00');
    set('Starts', '2027-11-07T01:30');
    expect(doors()).toHaveValue('2027-11-07T02:00');
    fireEvent.click(
      within(screen.getByTestId('startsAt-occurrence')).getByLabelText(
        '1:30 AM CST (the second time)',
      ),
    );
    // 1:30 AM CST is 07:30Z; an hour before is 06:30Z, 1:30 AM CDT, the first 1:30 AM.
    expect(doors()).toHaveValue('2027-11-07T01:30');
    expect(
      within(screen.getByTestId('doorsOpenAt-occurrence')).getByLabelText(
        '1:30 AM CDT (the first time)',
      ),
    ).toBeChecked();
  });
});

describe('checks before sending (FR-004, FR-005)', () => {
  it.each(['2026-11-20T12:59', '2026-11-20T19:01'])(
    'doors at %s with a 7:00 PM start: the range message under the field and in the banner, nothing sent',
    async (value) => {
      const api = newForm();
      await fill('2026-11-20T19:00', '2026-11-20T22:00');
      set('Doors open', value);
      expect(screen.getByTestId('doorsOpenAt-range')).toHaveTextContent(RANGE);
      save();
      expect(await screen.findByTestId('error-banner')).toHaveTextContent(RANGE);
      expect(screen.getByTestId('doorsOpenAt-range')).toHaveAttribute('role', 'alert');
      expect(posted(api)).toHaveLength(0);
      expect(doors()).toHaveValue(value);
      expect(screen.getByLabelText('Event name')).toHaveValue('Fall Concert');
    },
  );

  it.each([
    ['2026-11-20T13:00', '2026-11-20T13:00:00-06:00'],
    ['2026-11-20T19:00', '2026-11-20T19:00:00-06:00'],
    ['2026-11-20T17:30', '2026-11-20T17:30:00-06:00'],
  ])('doors at %s: sent with the venue offset', async (value, sent) => {
    const api = newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Doors open', value);
    expect(screen.queryByTestId('doorsOpenAt-range')).toBeNull();
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({
      startsAt: '2026-11-20T19:00:00-06:00',
      doorsOpenAt: sent,
    });
  });

  it('empty: "Enter when doors open." and nothing sent', async () => {
    const api = newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Doors open', '');
    save();
    expect(await screen.findByTestId('error-banner')).toHaveTextContent('Enter when doors open.');
    expect(posted(api)).toHaveLength(0);
  });

  it("a skipped doors time: 020's message for Doors open, nothing sent", async () => {
    const api = newForm();
    await fill('2027-03-14T05:00', '2027-03-14T07:00');
    set('Doors open', '2027-03-14T02:30');
    const message =
      "2:30 AM on Mar 14, 2027 doesn't exist in Central Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time.";
    expect(screen.getByTestId('doorsOpenAt-skipped')).toHaveTextContent(message);
    save();
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(message);
    expect(posted(api)).toHaveLength(0);
  });

  it('a repeated doors time: asked which, refused until chosen, sent with the chosen offset', async () => {
    const api = newForm();
    await fill('2027-11-07T03:00', '2027-11-07T05:00');
    set('Doors open', '2027-11-07T01:30');
    const group = screen.getByTestId('doorsOpenAt-occurrence');
    save();
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Choose which 1:30 AM you mean.',
    );
    expect(posted(api)).toHaveLength(0);
    fireEvent.click(within(group).getByLabelText('1:30 AM CST (the second time)'));
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({ doorsOpenAt: '2027-11-07T01:30:00-06:00' });
  });
});

describe('what is sent (FR-007)', () => {
  it('the create body carries the default doors with the venue offset', async () => {
    const api = newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({ doorsOpenAt: '2026-11-20T18:00:00-06:00' });
  });

  it('an edit body carries doors too', async () => {
    const api = editForm();
    await vi.waitFor(() =>
      expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('General'),
    );
    set('Starts', '2026-11-20T20:00');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      startsAt: '2026-11-20T20:00:00-06:00',
      doorsOpenAt: '2026-11-20T18:30:00-06:00',
    });
  });

  it("shows the Backend's DOORS_OPEN_OUT_OF_RANGE in the banner, every value kept", async () => {
    newForm(() =>
      json({ error: { code: 'DOORS_OPEN_OUT_OF_RANGE', message: RANGE, details: {} } }, 400),
    );
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Doors open', '2026-11-20T17:30');
    save();
    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', 'DOORS_OPEN_OUT_OF_RANGE');
    expect(banner).toHaveTextContent(RANGE);
    expect(doors()).toHaveValue('2026-11-20T17:30');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-11-20T19:00');
  });
});
