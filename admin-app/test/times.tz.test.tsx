import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Attendees } from '../src/pages/Attendees';
import { EventDetail } from '../src/pages/EventDetail';
import { EventList } from '../src/pages/EventList';
import { LocationDetail } from '../src/pages/LocationDetail';
import { Reports } from '../src/pages/Reports';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, ORDERS, REPORT, VENUE } from './fixtures-005';

/**
 * Spec 020 US2 scenario 5, FR-020 to FR-023 (research R12, R15): every Admin page shows an event
 * time in its venue's local time with the zone's abbreviation, the same under any device zone
 * (`npm run test:tz`); Reports' "as of" is the viewer's own time, labelled.
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
const HNL = {
  ...VENUE,
  id: 'v-hnl',
  name: 'Ward Hall',
  timeZone: 'Pacific/Honolulu',
  timeZoneSource: 'STATE',
};

/** 7:00 PM to 10:00 PM local on Oct 1, 2026 at each venue. */
const at = (venue: typeof EAST, id: string, name: string, startsAt: string, endsAt: string) => ({
  ...EVENT,
  id,
  name,
  locationId: venue.id,
  location: venue,
  startsAt,
  endsAt,
});
const E_EAST = at(
  EAST,
  'e-east',
  'East Show',
  '2026-10-01T23:00:00.000Z',
  '2026-10-02T02:00:00.000Z',
);
const E_PHX = at(
  PHX,
  'e-phx',
  'Desert Show',
  '2026-10-02T02:00:00.000Z',
  '2026-10-02T05:00:00.000Z',
);
const E_HNL = at(
  HNL,
  'e-hnl',
  'Island Show',
  '2026-10-02T05:00:00.000Z',
  '2026-10-02T08:00:00.000Z',
);

const page = (path: string, route: string, element: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );

describe('event list (R12)', () => {
  it("shows each event's date and times in its venue's zone", async () => {
    stubApi({
      'GET /events': json([E_EAST, E_PHX, E_HNL]),
      'GET /locations': json([EAST, PHX, HNL]),
    });
    page('/events', '/events', <EventList />);
    const row = async (name: string) =>
      (await screen.findByRole('link', { name })).closest('tr') as HTMLElement;
    for (const [name, times] of [
      ['East Show', '7:00 PM EDT – 10:00 PM EDT'],
      ['Desert Show', '7:00 PM MST – 10:00 PM MST'],
      ['Island Show', '7:00 PM HST – 10:00 PM HST'],
    ]) {
      const r = await row(name);
      expect(within(r).getByText('Oct 1, 2026')).toBeInTheDocument();
      expect(within(r).getByText(times)).toBeInTheDocument();
    }
  });

  it('gives an event across midnight its end date', async () => {
    const late = at(
      EAST,
      'e-late',
      'Late Show',
      '2026-10-02T02:00:00.000Z',
      '2026-10-02T05:00:00.000Z',
    );
    stubApi({ 'GET /events': json([late]), 'GET /locations': json([EAST]) });
    page('/events', '/events', <EventList />);
    const r = (await screen.findByRole('link', { name: 'Late Show' })).closest('tr') as HTMLElement;
    expect(within(r).getByText('10:00 PM EDT – Oct 2, 2026, 1:00 AM EDT')).toBeInTheDocument();
  });

  it('sends fromDate and toDate exactly as typed (FR-020)', async () => {
    const api = stubApi({ 'GET /events': json([]), 'GET /locations': json([EAST]) });
    page('/events', '/events', <EventList />);
    await screen.findByText('No events scheduled');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(api.calls.filter((c) => c.path === '/events')).toHaveLength(2));
    const last = api.calls.filter((c) => c.path === '/events').at(-1)!;
    expect(Object.fromEntries(new URLSearchParams(last.search))).toEqual({
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
    });
  });
});

describe('event page', () => {
  it.each([
    [E_EAST, 'Oct 1, 2026, 7:00 PM EDT', 'Oct 1, 2026, 10:00 PM EDT'],
    [E_PHX, 'Oct 1, 2026, 7:00 PM MST', 'Oct 1, 2026, 10:00 PM MST'],
    [E_HNL, 'Oct 1, 2026, 7:00 PM HST', 'Oct 1, 2026, 10:00 PM HST'],
  ])('shows $name in its venue zone', async (event, starts, ends) => {
    stubApi({ [`GET /events/${event.id}`]: json(event) });
    page(`/events/${event.id}`, '/events/:id', <EventDetail />);
    expect(await screen.findByText(starts)).toBeInTheDocument();
    expect(screen.getByText(ends)).toBeInTheDocument();
  });
});

describe('venue page events', () => {
  it("lists the venue's events in its zone", async () => {
    stubApi({ [`GET /locations/${PHX.id}`]: json(PHX), 'GET /events': json([E_PHX]) });
    page(`/locations/${PHX.id}`, '/locations/:id', <LocationDetail />);
    expect(await screen.findByText('Oct 1, 2026, 7:00 PM MST')).toBeInTheDocument();
    expect(screen.getByText('Oct 1, 2026, 10:00 PM MST')).toBeInTheDocument();
  });
});

describe('attendees', () => {
  it("shows the checked-in time in the event's venue zone", async () => {
    const event = { ...E_HNL, id: EVENT.id };
    stubApi({
      [`GET /events/${EVENT.id}`]: json(event),
      [`GET /events/${EVENT.id}/attendees`]: json(ORDERS),
    });
    page(`/events/${EVENT.id}/attendees`, '/events/:id/attendees', <Attendees />);
    // ORDERS' first ticket was checked in at 22:45Z on Nov 1: 12:45 PM HST.
    expect(await screen.findByText(/checked in Nov 1, 2026, 12:45 PM HST/)).toBeInTheDocument();
  });
});

describe('reports', () => {
  it("dates each event in its venue's zone and labels the viewer's own 'as of' time", async () => {
    const report = {
      ...REPORT,
      generatedAt: '2026-10-01T23:42:00.000Z',
      events: REPORT.events.map((e, i) => ({
        ...e,
        // 9:00 PM PDT on Oct 1 is Oct 2 in UTC and in Eastern time.
        startsAt: '2026-10-02T04:00:00.000Z',
        timeZone: i === 0 ? 'America/Los_Angeles' : 'America/New_York',
      })),
    };
    stubApi({ 'GET /reports/sales': json(report) });
    page('/reports', '/reports', <Reports />);
    const first = (await screen.findByRole('link', { name: report.events[0].name })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(first).getByText('Oct 1, 2026')).toBeInTheDocument();
    const second = screen
      .getByRole('link', { name: report.events[1].name })
      .closest('tr') as HTMLElement;
    expect(within(second).getByText('Oct 2, 2026')).toBeInTheDocument();

    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const abbr = new Intl.DateTimeFormat('en-US', { timeZone: own, timeZoneName: 'short' })
      .formatToParts(new Date(report.generatedAt))
      .find((p) => p.type === 'timeZoneName')?.value;
    expect(screen.getByText(/as of/).textContent).toMatch(new RegExp(` ${abbr}$`));
  });
});
