import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Attendees } from '../src/pages/Attendees';
import { EventDetail } from '../src/pages/EventDetail';
import { EventList } from '../src/pages/EventList';
import { LocationDetail } from '../src/pages/LocationDetail';
import { LocationForm } from '../src/pages/LocationForm';
import { Reports } from '../src/pages/Reports';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, REPORT, VENUE } from './fixtures-005';

/**
 * Spec 030 US3 (FR-008 to FR-013; research R4 to R6, R9): the Admin app hides past events until
 * Show past events is on, keeps the toggle in the address, and marks past events Ended.
 */
const NOW = Date.parse('2026-11-09T17:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const iso = (ms: number) => new Date(ms).toISOString();

const at = (id: string, name: string, startsAt: number, endsAt: number, over = {}) => ({
  ...EVENT,
  id,
  name,
  startsAt: iso(startsAt),
  endsAt: iso(endsAt),
  doorsOpenAt: iso(startsAt - HOUR),
  entryOpensAt: iso(startsAt - 2 * HOUR),
  ...over,
});
const ENDED = at(
  '11111111-0000-4000-8000-000000000001',
  'Ended Show',
  NOW - 4 * HOUR,
  NOW - MINUTE,
);
const NOW_PLAYING = at(
  '11111111-0000-4000-8000-000000000002',
  'Now Playing',
  NOW - 30 * MINUTE,
  NOW + 2 * HOUR,
);
const AHEAD = at(
  '11111111-0000-4000-8000-000000000003',
  'Coming Soon',
  NOW + 7 * 24 * HOUR,
  NOW + 7 * 24 * HOUR + 3 * HOUR,
);
const GONE = at(
  '11111111-0000-4000-8000-000000000004',
  'Rained Out',
  NOW - 8 * HOUR,
  NOW - 6 * HOUR,
  { status: 'CANCELLED', cancelledAt: iso(NOW - 24 * HOUR) },
);

type Call = { method: string; path: string; search: string };
const eventQueries = (calls: Call[]) =>
  calls
    .filter((c) => c.method === 'GET' && c.path === '/events')
    .map((c) => Object.fromEntries(new URLSearchParams(c.search)));

let currentUrl = '';
function UrlSpy() {
  const loc = useLocation();
  currentUrl = `${loc.pathname}${loc.search}`;
  return null;
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <UrlSpy />
      <Routes>
        <Route path="/events" element={<EventList />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="/events/:id/attendees" element={<Attendees />} />
        <Route path="/locations/:id" element={<LocationDetail />} />
        <Route path="/locations/:id/edit" element={<LocationForm />} />
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </MemoryRouter>,
  );

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;
const toggle = () => screen.getByRole('checkbox', { name: 'Show past events' });
const addressParams = () => Object.fromEntries(new URLSearchParams(currentUrl.split('?')[1]));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** `GET /events` as the Backend answers: past events only with `includePast=true`. */
function stubEvents(all = [GONE, ENDED, NOW_PLAYING, AHEAD], upcoming = [NOW_PLAYING, AHEAD]) {
  let calls: Call[] = [];
  const api = stubApi({
    'GET /events': () => {
      const last = calls.filter((c) => c.path === '/events').at(-1);
      const past = new URLSearchParams(last?.search).get('includePast') === 'true';
      return json(past ? all : upcoming);
    },
    'GET /locations': json([VENUE]),
    [`GET /locations/${VENUE.id}`]: json(VENUE),
    [`GET /locations/${VENUE.id}/layout`]: json({ locationId: VENUE.id, sections: [] }),
  });
  calls = api.calls;
  return api;
}

describe('the Events page (FR-008, FR-009, FR-011)', () => {
  it('asks without includePast, says past events are hidden, and starts with the toggle off', async () => {
    const { calls } = stubEvents();
    renderAt('/events');

    expect(await screen.findByRole('link', { name: 'Now Playing' })).toBeInTheDocument();
    expect(eventQueries(calls)[0]).toEqual({});
    expect(screen.getByText(/past events hidden/)).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
    expect(screen.queryByRole('link', { name: 'Ended Show' })).not.toBeInTheDocument();
  });

  it('turned on, asks again at once with includePast=true, puts past=1 in the address, and marks past events Ended', async () => {
    const { calls } = stubEvents();
    renderAt('/events');
    await screen.findByRole('link', { name: 'Now Playing' });

    await userEvent.click(toggle());

    expect(await screen.findByRole('link', { name: 'Ended Show' })).toBeInTheDocument();
    expect(eventQueries(calls).at(-1)).toEqual({ includePast: 'true' });
    expect(addressParams()).toEqual({ past: '1' });
    expect(within(rowOf('Ended Show')).getByText('Ended')).toBeInTheDocument();
    expect(within(rowOf('Now Playing')).queryByText('Ended')).not.toBeInTheDocument();
    expect(within(rowOf('Coming Soon')).queryByText('Ended')).not.toBeInTheDocument();
    expect(screen.queryByText(/past events hidden/)).not.toBeInTheDocument();
    expect(toggle()).toBeChecked();
  });

  it('opened at ?past=1, starts on and asks with includePast=true', async () => {
    const { calls } = stubEvents();
    renderAt('/events?past=1');

    expect(await screen.findByRole('link', { name: 'Ended Show' })).toBeInTheDocument();
    expect(toggle()).toBeChecked();
    expect(eventQueries(calls)[0]).toEqual({ includePast: 'true' });
  });

  it('keeps past=1 through a search, and sends q with includePast', async () => {
    const { calls } = stubEvents();
    renderAt('/events?past=1');
    await screen.findByRole('link', { name: 'Ended Show' });

    await userEvent.type(screen.getByLabelText('Search events'), 'show');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await vi.waitFor(() => expect(addressParams()).toEqual({ q: 'show', past: '1' }));
    await vi.waitFor(() =>
      expect(eventQueries(calls).at(-1)).toEqual({ q: 'show', includePast: 'true' }),
    );
  });

  it('Clear empties the search and keeps the toggle on', async () => {
    const { calls } = stubEvents();
    renderAt('/events?q=show&past=1');
    await screen.findByRole('link', { name: 'Ended Show' });

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await vi.waitFor(() => expect(addressParams()).toEqual({ past: '1' }));
    expect(screen.getByLabelText('Search events')).toHaveValue('');
    expect(toggle()).toBeChecked();
    await vi.waitFor(() => expect(eventQueries(calls).at(-1)).toEqual({ includePast: 'true' }));
  });

  it('off, an empty search names Show past events', async () => {
    stubEvents([], []);
    renderAt('/events?from=2026-10-01&to=2026-10-31');

    expect(await screen.findByText('No events match these filters.')).toBeInTheDocument();
    expect(
      screen.getByText('Past events are hidden; turn on Show past events to include them.'),
    ).toBeInTheDocument();
  });

  it('marks a cancelled event that has ended both Cancelled and Ended', async () => {
    stubEvents();
    renderAt('/events?past=1');

    await screen.findByRole('link', { name: 'Rained Out' });
    const row = within(rowOf('Rained Out'));
    expect(row.getByText('Cancelled')).toBeInTheDocument();
    expect(row.getByText('Ended')).toBeInTheDocument();
  });
});

describe("a venue's page (FR-008, FR-009, FR-011)", () => {
  const PATH = `/locations/${VENUE.id}`;

  it('asks with its locationId only, says past events are hidden, and starts off', async () => {
    const { calls } = stubEvents();
    renderAt(PATH);

    expect(await screen.findByRole('link', { name: 'Now Playing' })).toBeInTheDocument();
    expect(eventQueries(calls)).toEqual([{ locationId: VENUE.id }]);
    expect(screen.getByText('Past events are hidden.')).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
  });

  it('turned on, asks with includePast=true, keeps past=1 in its address, and marks Ended', async () => {
    const { calls } = stubEvents();
    renderAt(PATH);
    await screen.findByRole('link', { name: 'Now Playing' });

    await userEvent.click(toggle());

    expect(await screen.findByRole('link', { name: 'Ended Show' })).toBeInTheDocument();
    expect(eventQueries(calls).at(-1)).toEqual({ locationId: VENUE.id, includePast: 'true' });
    expect(currentUrl).toBe(`${PATH}?past=1`);
    expect(within(rowOf('Ended Show')).getByText('Ended')).toBeInTheDocument();
    expect(within(rowOf('Now Playing')).queryByText('Ended')).not.toBeInTheDocument();
    expect(screen.queryByText('Past events are hidden.')).not.toBeInTheDocument();
  });

  it('opened at ?past=1, starts on and asks with includePast=true', async () => {
    const { calls } = stubEvents();
    renderAt(`${PATH}?past=1`);

    expect(await screen.findByRole('link', { name: 'Ended Show' })).toBeInTheDocument();
    expect(toggle()).toBeChecked();
    expect(eventQueries(calls)[0]).toEqual({ locationId: VENUE.id, includePast: 'true' });
  });

  it('with nothing coming, still says past events are hidden', async () => {
    stubEvents([ENDED], []);
    renderAt(PATH);

    expect(await screen.findByText('Nothing is scheduled here.')).toBeInTheDocument();
    expect(screen.getByText('Past events are hidden.')).toBeInTheDocument();
  });

  it('marks a cancelled event that has ended both Cancelled and Ended', async () => {
    stubEvents();
    renderAt(`${PATH}?past=1`);

    await screen.findByRole('link', { name: 'Rained Out' });
    const row = within(rowOf('Rained Out'));
    expect(row.getByText('Cancelled')).toBeInTheDocument();
    expect(row.getByText('Ended')).toBeInTheDocument();
  });
});

describe('the venue form (FR-010)', () => {
  it('always counts past events when asking whether the venue has events', async () => {
    const { calls } = stubEvents();
    renderAt(`/locations/${VENUE.id}/edit`);

    await vi.waitFor(() =>
      expect(eventQueries(calls)).toEqual([{ locationId: VENUE.id, includePast: 'true' }]),
    );
  });
});

describe("a past event's own pages (FR-011, FR-013; research R9)", () => {
  it('its page shows Ended beside the name', async () => {
    stubApi({ [`GET /events/${ENDED.id}`]: json(ENDED) });
    renderAt(`/events/${ENDED.id}`);

    const heading = await screen.findByRole('heading', { level: 1, name: /Ended Show/ });
    expect(within(heading).getByText('Ended')).toBeInTheDocument();
  });

  it('a cancelled past event shows Cancelled, then Ended', async () => {
    stubApi({ [`GET /events/${GONE.id}`]: json(GONE) });
    renderAt(`/events/${GONE.id}`);

    const heading = await screen.findByRole('heading', { level: 1, name: /Rained Out/ });
    expect(
      within(heading)
        .getAllByText(/^(Cancelled|Ended)$/)
        .map((p) => p.textContent),
    ).toEqual(['Cancelled', 'Ended']);
  });

  it('an event in progress is not marked Ended', async () => {
    stubApi({ [`GET /events/${NOW_PLAYING.id}`]: json(NOW_PLAYING) });
    renderAt(`/events/${NOW_PLAYING.id}`);

    const heading = await screen.findByRole('heading', { level: 1, name: /Now Playing/ });
    expect(within(heading).queryByText('Ended')).not.toBeInTheDocument();
  });

  it('its attendees page loads', async () => {
    stubApi({
      [`GET /events/${ENDED.id}`]: json(ENDED),
      [`GET /events/${ENDED.id}/attendees`]: json([]),
    });
    renderAt(`/events/${ENDED.id}/attendees`);

    expect(
      await screen.findByRole('heading', { name: 'Attendees: Ended Show' }),
    ).toBeInTheDocument();
  });

  it('Reports lists it, and its name opens its page', async () => {
    const report = {
      ...REPORT,
      events: [
        { ...REPORT.events[0], eventId: ENDED.id, name: 'Ended Show', startsAt: ENDED.startsAt },
      ],
    };
    stubApi({ 'GET /reports/sales': json(report) });
    renderAt('/reports');

    expect(await screen.findByRole('link', { name: 'Ended Show' })).toHaveAttribute(
      'href',
      `/events/${ENDED.id}`,
    );
  });
});
