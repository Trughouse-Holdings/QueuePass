import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { doorsOpenRangeMessage } from '@queuepass/shared';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { expectLocalDateTime, setLocalDateTime } from './helpers/event-times';
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
    // Spec 031 FR-008: the ticket types go in the one POST /events.
    'POST /events': post,
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

const set = (label: string, value: string) => {
  if (label === 'Starts' || label === 'Ends' || label === 'Doors open') {
    if (label === 'Doors open' && screen.queryByLabelText('At a set time')) {
      fireEvent.click(screen.getByLabelText('At a set time'));
    }
    if (value === '') {
      if (label === 'Doors open') fireEvent.click(screen.getByLabelText('At a set time'));
      fireEvent.change(screen.getByLabelText(`${label} date`, { exact: true }), {
        target: { value: '' },
      });
      fireEvent.change(screen.getByLabelText(`${label} time`, { exact: true }), {
        target: { value: '' },
      });
      return;
    }
    setLocalDateTime(label, value);
    return;
  }
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

async function fill(starts: string, ends: string) {
  await screen.findByRole('option', { name: /Prairie Hall/ });
  set('Event name', 'Fall Concert');
  set('Venue', CENTRAL.id);
  set('Starts', starts);
  set('Ends', ends);
  await screen.findByLabelText('Ticket type 1 name');
  set('Ticket type 1 name', 'General');
  set('Ticket type 1 price', '45.00');
  set('Ticket type 1 quantity', '10');
}

const preview = () => screen.getByTestId('doorsOpenAt-preview');

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));
const posted = (api: ReturnType<typeof stubApi>) =>
  api.calls.filter((c) => c.method === 'POST' && c.path === '/events').map((c) => c.body);

// 7:00 PM CST on Nov 20, 2026 is 01:00Z on Nov 21.
const RANGE = doorsOpenRangeMessage('2026-11-21T01:00:00Z', 'America/Chicago');

describe('the Doors open field (036 FR-001, FR-003, FR-006, FR-007)', () => {
  it('opens Before the start, 1 hour, then the shown time follows the start', async () => {
    newForm();
    await screen.findByRole('option', { name: /Prairie Hall/ });
    set('Venue', CENTRAL.id);
    expect(screen.getByLabelText('Before the start')).toBeChecked();
    expect(screen.getByLabelText('How long before the start')).toHaveValue('60');
    expect(screen.queryByTestId('doorsOpenAt-preview')).toBeNull();
    expect(
      screen
        .getByRole('group', { name: 'Doors open' })
        .compareDocumentPosition(screen.getByLabelText('Starts date')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    set('Starts', '2026-11-20T19:00');
    expect(preview()).toHaveTextContent('Doors open at 6:00 PM CST');
    set('Starts', '2026-11-20T20:00');
    expect(preview()).toHaveTextContent('Doors open at 7:00 PM CST');
  });

  it('in At a set time mode, keeps the doors date and time when the start changes', async () => {
    newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Doors open', '2026-11-20T17:30');
    set('Starts', '2026-11-20T20:00');
    expectLocalDateTime('Doors open', '2026-11-20T17:30');
  });

  it('on edit of a 90-minute gap opens Before the start and keeps that length when the start moves', async () => {
    editForm();
    await vi.waitFor(() => expect(preview()).toHaveTextContent('Doors open at 5:30 PM CST'));
    expect(screen.getByLabelText('Before the start')).toBeChecked();
    expect(screen.getByLabelText('How long before the start')).toHaveValue('90');
    set('Starts', '2026-11-20T20:00');
    expect(preview()).toHaveTextContent('Doors open at 6:30 PM CST');
  });

  it('switching modes keeps the same doors-open time', async () => {
    newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    expect(preview()).toHaveTextContent('Doors open at 6:00 PM CST');
    fireEvent.click(screen.getByLabelText('At a set time'));
    expectLocalDateTime('Doors open', '2026-11-20T18:00');
    fireEvent.click(screen.getByLabelText('Before the start'));
    expect(screen.getByLabelText('How long before the start')).toHaveValue('60');
    expect(preview()).toHaveTextContent('Doors open at 6:00 PM CST');
  });

  it('does not follow a start that is a repeated time not yet chosen, then follows the chosen one', async () => {
    newForm();
    await fill('2027-11-07T03:00', '2027-11-07T05:00');
    expect(preview()).toHaveTextContent('Doors open at 2:00 AM CST');
    set('Starts', '2027-11-07T01:30');
    // The start does not yet name one moment, so the resulting-time line is hidden
    // and doors are not recomputed (036 edge case; 025 FR-003).
    expect(screen.queryByTestId('doorsOpenAt-preview')).toBeNull();
    fireEvent.click(
      within(screen.getByTestId('startsAt-occurrence')).getByLabelText(
        '1:30 AM CST (the second time)',
      ),
    );
    // 1:30 AM CST is 07:30Z; an hour before is 06:30Z, 1:30 AM CDT, the first 1:30 AM.
    expect(preview()).toHaveTextContent('Doors open at 1:30 AM CDT');
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
      expect(screen.queryByTestId('error-banner')).toBeNull();
      expect(screen.getByTestId('doorsOpenAt-range')).toHaveTextContent(RANGE);
      expect(screen.getByTestId('doorsOpenAt-range')).toHaveAttribute('role', 'alert');
      expect(posted(api)).toHaveLength(0);
      expectLocalDateTime('Doors open', value);
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
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('doorsOpenAt-error')).toHaveTextContent(
      'Enter when doors open.',
    );
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
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(screen.getByTestId('doorsOpenAt-skipped')).toHaveTextContent(message);
    expect(posted(api)).toHaveLength(0);
  });

  it('a repeated doors time: asked which, refused until chosen, sent with the chosen offset', async () => {
    const api = newForm();
    await fill('2027-11-07T03:00', '2027-11-07T05:00');
    set('Doors open', '2027-11-07T01:30');
    const group = screen.getByTestId('doorsOpenAt-occurrence');
    save();
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('doorsOpenAt-error')).toHaveTextContent(
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
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(await screen.findByTestId('doorsOpenAt-error')).toHaveTextContent(RANGE);
    expectLocalDateTime('Doors open', '2026-11-20T17:30');
    expectLocalDateTime('Starts', '2026-11-20T19:00');
  });
});

describe('following, the remaining cases (T035)', () => {
  it('sets a repeated doors time to its second occurrence when that is the moment', async () => {
    newForm();
    // 2:30 AM CST on 2027-11-07 is 08:30Z; an hour before is 07:30Z, the second 1:30 AM (CST).
    await fill('2027-11-07T02:30', '2027-11-07T04:00');
    expect(preview()).toHaveTextContent('Doors open at 1:30 AM CST');
  });

  it('leaves Doors open as it is when the start is cleared', async () => {
    newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Starts', '');
    expect(screen.queryByTestId('doorsOpenAt-preview')).toBeNull();
    fireEvent.click(screen.getByLabelText('At a set time'));
    expectLocalDateTime('Doors open', '2026-11-20T18:00');
  });

  it('on edit of an event without doorsOpenAt (a Backend before 025), starts empty and follows 1 hour before', async () => {
    const { doorsOpenAt: _d, entryOpensAt: _e, ...old } = STORED;
    stubApi({
      'GET /locations': json([CENTRAL]),
      [`GET /events/${EVENT.id}`]: json(old),
      [`GET /events/${EVENT.id}/tiers`]: json([TIER]),
      [`GET /events/${EVENT.id}/seats`]: json({
        eventId: EVENT.id,
        reservedSeating: false,
        sections: [],
      }),
    });
    render(
      <MemoryRouter initialEntries={[`/events/${EVENT.id}/edit`]}>
        <Routes>
          <Route path="/events/:id/edit" element={<EventForm />} />
        </Routes>
      </MemoryRouter>,
    );
    await vi.waitFor(() => expectLocalDateTime('Starts', '2026-11-20T19:00'));
    expect(preview()).toHaveTextContent('Doors open at 6:00 PM CST');
    set('Starts', '2026-11-20T20:00');
    expect(preview()).toHaveTextContent('Doors open at 7:00 PM CST');
  });
});

/**
 * Spec 036 independent review round 1 (2026-11-10): FR-004, FR-010, FR-014, FR-015, FR-016, US1
 * AS4, US2 AS5, and the offset sent for a derived doors time on a fall-back night.
 */
function editWith(doorsOpenAt: string) {
  const stored = { ...STORED, doorsOpenAt };
  const api = stubApi({
    'GET /locations': json([CENTRAL]),
    [`GET /events/${EVENT.id}`]: json(stored),
    [`GET /events/${EVENT.id}/tiers`]: json([TIER]),
    [`GET /events/${EVENT.id}/seats`]: json({
      eventId: EVENT.id,
      reservedSeating: false,
      sections: [],
    }),
    [`PATCH /events/${EVENT.id}`]: json(stored),
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
const length = () => screen.getByLabelText('How long before the start');
const patched = (api: ReturnType<typeof stubApi>) =>
  api.calls.find((c) => c.method === 'PATCH')?.body;

describe('review round 1: modes and switching (FR-005, FR-014, FR-015, US1 AS4)', () => {
  it('an edit with a 10-minute gap opens At a set time with the exact stored time (US2 AS5)', async () => {
    // 6:50 PM CST is 00:50Z on Nov 21.
    const api = editWith('2026-11-21T00:50:00.000Z');
    await vi.waitFor(() => expectLocalDateTime('Doors open', '2026-11-20T18:50'));
    expect(screen.getByLabelText('At a set time')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(patched(api)).toMatchObject({ doorsOpenAt: '2026-11-20T18:50:00-06:00' });
  });

  it('switching to Before the start from an off-step gap shows no length, keeps the time, and sends it', async () => {
    const api = newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Doors open', '2026-11-20T17:50');
    fireEvent.click(screen.getByLabelText('Before the start'));
    expect(length()).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Choose a length…' })).toBeInTheDocument();
    expect(preview()).toHaveTextContent('Doors open at 5:50 PM CST');
    // Until a length is picked, a start change leaves doors put (FR-014).
    set('Starts', '2026-11-20T19:30');
    expect(preview()).toHaveTextContent('Doors open at 5:50 PM CST');
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({ doorsOpenAt: '2026-11-20T17:50:00-06:00' });
  });

  it('switching back to Before the start with empty doors derives them from the start (FR-015)', async () => {
    const api = newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Doors open', '');
    fireEvent.click(screen.getByLabelText('Before the start'));
    expect(length()).toHaveValue('60');
    expect(preview()).toHaveTextContent('Doors open at 6:00 PM CST');
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({ doorsOpenAt: '2026-11-20T18:00:00-06:00' });
  });

  it('switching back with an unchosen repeated doors time derives doors from the start (FR-015)', async () => {
    const api = newForm();
    await fill('2027-11-07T03:00', '2027-11-07T05:00');
    set('Doors open', '2027-11-07T01:30');
    fireEvent.click(screen.getByLabelText('Before the start'));
    expect(preview()).toHaveTextContent('Doors open at 2:00 AM CST');
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({ doorsOpenAt: '2027-11-07T02:00:00-06:00' });
  });

  it.each([
    ['0', '2026-11-20T19:00:00-06:00', 'Doors open at 7:00 PM CST'],
    ['120', '2026-11-20T17:00:00-06:00', 'Doors open at 5:00 PM CST'],
    ['360', '2026-11-20T13:00:00-06:00', 'Doors open at 1:00 PM CST'],
  ])(
    'picking %s minutes after the start is set sends the start minus that length (US1 AS4)',
    async (minutes, sent, line) => {
      const api = newForm();
      await fill('2026-11-20T19:00', '2026-11-20T22:00');
      fireEvent.change(length(), { target: { value: minutes } });
      expect(preview()).toHaveTextContent(line);
      expect(screen.queryByTestId('doorsOpenAt-range')).toBeNull();
      save();
      await screen.findByText('Event page', {}, { timeout: 3000 });
      expect(posted(api)[0]).toMatchObject({ doorsOpenAt: sent });
    },
  );

  it('a derived doors time on a fall-back night is sent with its own offset, and At a set time shows that occurrence', async () => {
    const api = newForm();
    await fill('2027-11-07T01:30', '2027-11-07T05:00');
    fireEvent.click(
      within(screen.getByTestId('startsAt-occurrence')).getByLabelText(
        '1:30 AM CST (the second time)',
      ),
    );
    // 1:30 AM CST is 07:30Z; an hour before is 06:30Z, the first 1:30 AM (CDT, -05:00).
    fireEvent.click(screen.getByLabelText('At a set time'));
    expect(
      within(screen.getByTestId('doorsOpenAt-occurrence')).getByLabelText(
        '1:30 AM CDT (the first time)',
      ),
    ).toBeChecked();
    fireEvent.click(screen.getByLabelText('Before the start'));
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({
      startsAt: '2027-11-07T01:30:00-06:00',
      doorsOpenAt: '2027-11-07T01:30:00-05:00',
    });
  });
});

describe('review round 1: the resulting-time line (FR-004, FR-016)', () => {
  it('is a polite live region from the first render, empty until the start names one moment', async () => {
    newForm();
    await screen.findByRole('option', { name: /Prairie Hall/ });
    set('Venue', CENTRAL.id);
    const live = document.getElementById('doorsOpenAt-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toBeEmptyDOMElement();
    expect(length().getAttribute('aria-describedby')).toContain('doorsOpenAt-live');
    set('Starts', '2026-11-20T19:00');
    expect(live).toHaveTextContent('Doors open at 6:00 PM CST');
  });

  it('says "the day before" when doors fall on the previous local date', async () => {
    newForm();
    await fill('2026-11-21T02:00', '2026-11-21T05:00');
    fireEvent.change(length(), { target: { value: '360' } });
    expect(preview()).toHaveTextContent('Doors open at 8:00 PM CST the day before');
    fireEvent.change(length(), { target: { value: '60' } });
    expect(preview()).toHaveTextContent(/^Doors open at 1:00 AM CST$/);
  });
});

describe('review round 1: split controls, errors and focus (FR-010)', () => {
  it('clearing the time keeps the date', async () => {
    newForm();
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    fireEvent.change(screen.getByLabelText('Starts time', { exact: true }), {
      target: { value: '' },
    });
    expect(screen.getByLabelText('Starts date', { exact: true })).toHaveValue('2026-11-20');
  });

  it('a missing start focuses Starts date; a missing start time focuses Starts time', async () => {
    newForm();
    await fill('', '2026-11-20T22:00');
    save();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Starts date', { exact: true })),
    );
    expect(screen.getByLabelText('Starts date', { exact: true })).toHaveAttribute(
      'aria-describedby',
      'startsAt-error',
    );
    expect(screen.getByLabelText('Starts time', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    fireEvent.change(screen.getByLabelText('Starts date', { exact: true }), {
      target: { value: '2026-11-20' },
    });
    save();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Starts time', { exact: true })),
    );
  });

  it('a Backend doors refusal in Before the start is on the length select, which takes focus', async () => {
    newForm(() =>
      json({ error: { code: 'DOORS_OPEN_OUT_OF_RANGE', message: RANGE, details: {} } }, 400),
    );
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    save();
    expect(await screen.findByTestId('doorsOpenAt-error')).toHaveTextContent(RANGE);
    await vi.waitFor(() => expect(document.activeElement).toBe(length()));
    expect(length()).toHaveAttribute('aria-invalid', 'true');
    expect(length().getAttribute('aria-describedby')).toContain('doorsOpenAt-error');
  });

  it('a Backend doors refusal in At a set time focuses Doors open date', async () => {
    newForm(() =>
      json({ error: { code: 'DOORS_OPEN_OUT_OF_RANGE', message: RANGE, details: {} } }, 400),
    );
    await fill('2026-11-20T19:00', '2026-11-20T22:00');
    set('Doors open', '2026-11-20T17:30');
    save();
    expect(await screen.findByTestId('doorsOpenAt-error')).toHaveTextContent(RANGE);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText('Doors open date', { exact: true }),
      ),
    );
  });
});
