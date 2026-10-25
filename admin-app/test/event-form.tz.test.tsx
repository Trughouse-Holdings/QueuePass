import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';

/**
 * Spec 020 US2, US3 (FR-014 to FR-017, FR-022, FR-026; research R13): the event form reads the
 * typed times in the venue's zone, whatever the browser's zone is. `npm run test:tz` runs this
 * file under four device zones, and CI reruns it in America/Los_Angeles.
 */
afterEach(() => vi.unstubAllGlobals());

const EAST = {
  ...VENUE,
  id: 'v-east',
  name: 'Riverside',
  timeZone: 'America/New_York',
  timeZoneSource: 'ADDRESS',
};
const PHX = {
  ...VENUE,
  id: 'v-phx',
  name: 'Phoenix Hall',
  timeZone: 'America/Phoenix',
  timeZoneSource: 'ADDRESS',
};
const NO_LAYOUT = (id: string) => ({ locationId: id, totalSeats: 0, sections: [] });
const TIER = {
  id: 't1',
  eventId: EVENT.id,
  name: 'General',
  price: '45.00',
  quantity: 10,
  createdAt: EVENT.createdAt,
  updatedAt: EVENT.updatedAt,
};

function newForm(post: () => Response = () => json({ ...EVENT, locationId: EAST.id }, 201)) {
  const api = stubApi({
    'GET /locations': json([EAST, PHX]),
    [`GET /locations/${EAST.id}/layout`]: json(NO_LAYOUT(EAST.id)),
    [`GET /locations/${PHX.id}/layout`]: json(NO_LAYOUT(PHX.id)),
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

function editForm(event: object) {
  const e = { ...EVENT, ...event } as typeof EVENT;
  const api = stubApi({
    'GET /locations': json([EAST, PHX]),
    [`GET /events/${EVENT.id}`]: json(e),
    [`GET /events/${EVENT.id}/tiers`]: json([TIER]),
    [`GET /events/${EVENT.id}/seats`]: json({
      eventId: EVENT.id,
      reservedSeating: false,
      sections: [],
    }),
    [`PATCH /events/${EVENT.id}`]: json(e),
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

async function fill(venue: string, starts: string, ends: string) {
  await screen.findByRole('option', { name: /Phoenix Hall/ });
  set('Event name', 'Fall Concert');
  set('Venue', venue);
  set('Starts', starts);
  set('Ends', ends);
  set('Ticket type 1 name', 'General');
  set('Ticket type 1 price', '45.00');
  set('Ticket type 1 quantity', '10');
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));
const posted = (api: ReturnType<typeof stubApi>) =>
  api.calls.filter((c) => c.method === 'POST' && c.path === '/events').map((c) => c.body);

describe('the zone line (FR-014)', () => {
  it('asks for a venue first, then names its zone with the abbreviation in force on the typed date', async () => {
    newForm();
    await screen.findByRole('option', { name: /Phoenix Hall/ });
    expect(screen.getByTestId('zone-line')).toHaveTextContent(
      "Choose a venue first: times are in the venue's local time.",
    );
    set('Venue', EAST.id);
    set('Starts', '2026-10-01T19:00');
    expect(screen.getByTestId('zone-line')).toHaveTextContent(
      "Times are in the venue's time zone: Eastern Time (EDT).",
    );
    set('Starts', '2026-12-05T20:00');
    expect(screen.getByTestId('zone-line')).toHaveTextContent(
      "Times are in the venue's time zone: Eastern Time (EST).",
    );
  });
});

describe('sending times in the venue zone (FR-014, FR-015)', () => {
  it("sends 19:00 and 22:00 at an Eastern venue with the venue's offset", async () => {
    const api = newForm();
    await fill(EAST.id, '2026-10-01T19:00', '2026-10-01T22:00');
    save();
    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(posted(api)[0]).toMatchObject({
      locationId: EAST.id,
      startsAt: '2026-10-01T19:00:00-04:00',
      endsAt: '2026-10-01T22:00:00-04:00',
    });
  });

  it('keeps the typed times when the venue changes, and sends them in the new zone', async () => {
    const api = newForm();
    await fill(EAST.id, '2026-10-01T19:00', '2026-10-01T22:00');
    set('Venue', PHX.id);
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-10-01T19:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-10-01T22:00');
    expect(screen.getByTestId('zone-line')).toHaveTextContent(
      "Times are in the venue's time zone: Arizona Time (no daylight saving) (MST).",
    );
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({
      startsAt: '2026-10-01T19:00:00-07:00',
      endsAt: '2026-10-01T22:00:00-07:00',
    });
  });
});

describe('daylight saving (FR-016, FR-017)', () => {
  it('refuses a skipped time before sending, keeping every value', async () => {
    const api = newForm();
    await fill(EAST.id, '2027-03-14T02:30', '2027-03-14T04:00');
    const message =
      "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time.";
    expect(screen.getByTestId('startsAt-skipped')).toHaveTextContent(message);
    save();
    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveTextContent(message);
    expect(posted(api)).toHaveLength(0);
    expect(screen.getByLabelText('Starts')).toHaveValue('2027-03-14T02:30');
    expect(screen.getByLabelText('Event name')).toHaveValue('Fall Concert');
  });

  it('accepts the same time at Phoenix (no daylight saving)', async () => {
    const api = newForm();
    await fill(PHX.id, '2027-03-14T02:30', '2027-03-14T04:00');
    expect(screen.queryByTestId('startsAt-skipped')).toBeNull();
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({ startsAt: '2027-03-14T02:30:00-07:00' });
  });

  it('asks which 1:30 AM is meant, refuses Save until chosen, and sends the chosen one', async () => {
    const api = newForm();
    await fill(EAST.id, '2027-11-07T01:30', '2027-11-07T03:30');
    const group = screen.getByTestId('startsAt-occurrence');
    expect(within(group).getByText('Which 1:30 AM?')).toBeInTheDocument();
    const first = within(group).getByLabelText('1:30 AM EDT (the first time)');
    const second = within(group).getByLabelText('1:30 AM EST (the second time)');
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();

    save();
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Choose which 1:30 AM you mean.',
    );
    expect(posted(api)).toHaveLength(0);

    fireEvent.click(second);
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({
      startsAt: '2027-11-07T01:30:00-05:00',
      endsAt: '2027-11-07T03:30:00-05:00',
    });
  });

  it('sends the first 1:30 AM with -04:00 when chosen', async () => {
    const api = newForm();
    await fill(EAST.id, '2027-11-07T01:30', '2027-11-07T03:30');
    fireEvent.click(screen.getByLabelText('1:30 AM EDT (the first time)'));
    save();
    await screen.findByText('Event page', {}, { timeout: 3000 });
    expect(posted(api)[0]).toMatchObject({ startsAt: '2027-11-07T01:30:00-04:00' });
  });
});

describe('editing (US2 scenario 4, US3 scenario 4)', () => {
  it("shows a stored event's start and end in its venue's local time", async () => {
    editForm({
      locationId: PHX.id,
      location: PHX,
      startsAt: '2026-10-02T02:00:00.000Z',
      endsAt: '2026-10-02T05:00:00.000Z',
    });
    await vi.waitFor(() => expect(screen.getByLabelText('Starts')).toHaveValue('2026-10-01T19:00'));
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-10-01T22:00');
  });

  it('shows 1:30 AM with EST chosen for an event stored at 06:30Z on 2027-11-07', async () => {
    const api = editForm({
      locationId: EAST.id,
      location: EAST,
      startsAt: '2027-11-07T06:30:00.000Z',
      endsAt: '2027-11-07T08:30:00.000Z',
    });
    await vi.waitFor(() => expect(screen.getByLabelText('Starts')).toHaveValue('2027-11-07T01:30'));
    expect(screen.getByLabelText('1:30 AM EST (the second time)')).toBeChecked();
    expect(screen.getByLabelText('1:30 AM EDT (the first time)')).not.toBeChecked();
    await vi.waitFor(() =>
      expect(screen.getByLabelText('Ticket type 1 name')).toHaveValue('General'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Event page', {}, { timeout: 3000 });
    const patch = api.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({
      startsAt: '2027-11-07T01:30:00-05:00',
      endsAt: '2027-11-07T03:30:00-05:00',
    });
  });
});

describe("the Backend's refusals (FR-026)", () => {
  it.each([
    [
      'LOCAL_TIME_SKIPPED',
      "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time.",
    ],
    [
      'UTC_OFFSET_MISMATCH',
      "startsAt is stated with offset -07:00, but Riverside is in Eastern Time, which is -04:00 at that time. Send the venue's local time with its offset.",
    ],
  ])('shows %s in the banner with every value kept', async (code, message) => {
    newForm(() => json({ error: { code, message, details: { field: 'startsAt' } } }, 400));
    await fill(EAST.id, '2026-10-01T19:00', '2026-10-01T22:00');
    save();
    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', code);
    expect(banner).toHaveTextContent(message);
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-10-01T19:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-10-01T22:00');
    expect(screen.getByLabelText('Venue')).toHaveValue(EAST.id);
  });

  it("names the conflicting event's times in the venue's zone", async () => {
    newForm(() =>
      json(
        {
          error: {
            code: 'SCHEDULING_CONFLICT',
            message:
              "This venue is already committed from Oct 1, 2026, 7:00 PM EDT to 10:00 PM EDT by 'X'.",
            details: {
              bufferMinutes: 60,
              conflictingEvent: {
                id: 'e-x',
                name: 'X',
                startsAt: '2026-10-01T23:00:00.000Z',
                endsAt: '2026-10-02T02:00:00.000Z',
              },
            },
          },
        },
        409,
      ),
    );
    await fill(EAST.id, '2026-10-01T20:00', '2026-10-01T23:00');
    save();
    expect(await screen.findByTestId('conflict-detail')).toHaveTextContent(
      'Conflicts with X, which runs Oct 1, 2026, 7:00 PM EDT – 10:00 PM EDT.',
    );
  });
});
