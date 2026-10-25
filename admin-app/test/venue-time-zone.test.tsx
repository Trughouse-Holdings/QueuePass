import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Location } from '@queuepass/shared';
import { LocationDetail } from '../src/pages/LocationDetail';
import { LocationForm } from '../src/pages/LocationForm';
import { LocationList } from '../src/pages/LocationList';
import { json, stubApi } from './helpers/api-stub';

/**
 * Spec 020 US4, US5 (FR-003, FR-004, FR-024, FR-026; research R14): the venue's zone on the list,
 * the venue page, and the form; the split-state question; zone-change refusals.
 */
afterEach(() => vi.unstubAllGlobals());

const ID = '6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e';
const PATH = `/locations/${ID}`;

const venue: Location = {
  id: ID,
  name: 'Rupp Arena',
  address: '430 W VINE ST, LEXINGTON, KY 40507',
  street: '430 W VINE ST',
  city: 'LEXINGTON',
  state: 'KY',
  zip: '40507',
  addressVerified: true,
  timeZone: 'America/New_York',
  timeZoneSource: 'ADDRESS',
  seatingCapacity: 20500,
  createdAt: '2026-10-11T12:00:00.000Z',
  updatedAt: '2026-10-11T12:00:00.000Z',
};
const NOT_FOUND = {
  error: {
    code: 'ADDRESS_NOT_FOUND',
    message: "We couldn't find 1 Arena Plaza, Louisville, KY 40202 as a US address.",
    details: { address: '1 Arena Plaza, Louisville, KY 40202' },
  },
};
const SAVE_ANYWAY = 'Save anyway (address not verified)';

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/locations" element={<LocationList />} />
        <Route path="/locations/new" element={<LocationForm />} />
        <Route path="/locations/:id" element={<LocationDetail />} />
        <Route path="/locations/:id/edit" element={<LocationForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

const set = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const writes = (api: ReturnType<typeof stubApi>) => api.calls.filter((c) => c.method !== 'GET');

function fill(values: Record<string, string> = {}): void {
  const v = {
    Name: 'KFC Yum! Center',
    'Street address': '1 Arena Plaza',
    City: 'Louisville',
    State: 'KY',
    'ZIP code': '40202',
    'Seating capacity': '22090',
    ...values,
  };
  for (const [label, value] of Object.entries(v)) set(label, value);
}
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));

describe('venue list and page (FR-024)', () => {
  // FR-024, US4 scenario 8 (review round 1, M1): the list shows the zone and how it was set.
  it('has a Time zone column with the zone and how it was set, for all four sources', async () => {
    stubApi({
      'GET /locations': json([
        { ...venue, id: 'v1', name: 'Address Hall', timeZoneSource: 'ADDRESS' },
        {
          ...venue,
          id: 'v2',
          name: 'Phoenix Hall',
          timeZone: 'America/Phoenix',
          timeZoneSource: 'STATE',
        },
        {
          ...venue,
          id: 'v3',
          name: 'Admin Hall',
          timeZone: 'America/Chicago',
          timeZoneSource: 'ADMIN',
        },
        { ...venue, id: 'v4', name: 'Old Hall', timeZoneSource: 'DEFAULT' },
      ]),
    });
    renderAt('/locations');
    await screen.findByRole('link', { name: 'Old Hall' });
    expect(screen.getByRole('columnheader', { name: 'Time zone' })).toBeInTheDocument();
    for (const [name, text] of [
      ['Address Hall', 'Eastern Time, from the address'],
      ['Phoenix Hall', 'Arizona Time (no daylight saving), from the state'],
      ['Admin Hall', 'Central Time, chosen by an admin'],
      ['Old Hall', 'Eastern Time, the default'],
    ]) {
      const row = screen.getByRole('link', { name }).closest('tr') as HTMLElement;
      expect(within(row).getByText(text)).toBeInTheDocument();
    }
  });

  it.each([
    ['ADDRESS', 'Time zone: Eastern Time, from the address.'],
    ['STATE', 'Time zone: Eastern Time, from the state.'],
    ['ADMIN', 'Time zone: Eastern Time, chosen by an admin.'],
    ['DEFAULT', 'Time zone: Eastern Time, the default.'],
  ])('the venue page says how the zone was set (%s)', async (timeZoneSource, text) => {
    stubApi({ [`GET ${PATH}`]: json({ ...venue, timeZoneSource }), 'GET /events': json([]) });
    renderAt(PATH);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

describe('the Time zone select (R4, R14)', () => {
  it('works it out from the address unless a zone is picked', async () => {
    const api = stubApi({ 'POST /locations': json(venue, 201), 'GET /locations': json([venue]) });
    renderAt('/locations/new');
    const select = screen.getByLabelText('Time zone');
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Work it out from the address',
      'Eastern Time',
      'Central Time',
      'Mountain Time',
      'Arizona Time (no daylight saving)',
      'Pacific Time',
      'Alaska Time',
      'Hawaii-Aleutian Time',
      'Hawaii Time',
    ]);
    fill();
    create();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).not.toHaveProperty('timeZone');
  });

  it('sends the picked zone', async () => {
    const api = stubApi({ 'POST /locations': json(venue, 201), 'GET /locations': json([venue]) });
    renderAt('/locations/new');
    fill();
    set('Time zone', 'America/Chicago');
    create();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toMatchObject({ timeZone: 'America/Chicago' });
  });

  it('names the zone and its source in the saved notice', async () => {
    stubApi({ 'POST /locations': json(venue, 201), 'GET /locations': json([venue]) });
    renderAt('/locations/new');
    fill();
    create();
    expect(
      await screen.findByText(
        'Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507. Time zone: Eastern Time, from the address.',
      ),
    ).toBeInTheDocument();
  });

  it('on edit, keeps the stored zone, until any address field changes', async () => {
    stubApi({ [`GET ${PATH}`]: json(venue), [`GET ${PATH}/layout`]: json({ sections: [] }) });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Rupp Arena'));
    const first = () => within(screen.getByLabelText('Time zone')).getAllByRole('option')[0];
    expect(first()).toHaveTextContent('Keep Eastern Time (from the address)');
    set('City', 'Louisville');
    expect(first()).toHaveTextContent('Work it out from the new address');
    set('City', 'LEXINGTON');
    expect(first()).toHaveTextContent('Keep Eastern Time (from the address)');
  });

  it('on edit, picking another zone says what happens to the events', async () => {
    const api = stubApi({
      [`GET ${PATH}`]: json(venue),
      [`GET ${PATH}/layout`]: json({ sections: [] }),
      [`PATCH ${PATH}`]: json({ ...venue, timeZone: 'America/Chicago', timeZoneSource: 'ADMIN' }),
      'GET /locations': json([venue]),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Rupp Arena'));
    expect(screen.queryByText(/keeps each event's local time/)).toBeNull();
    set('Time zone', 'America/Chicago');
    expect(
      screen.getByText(
        "Changing the time zone keeps each event's local time (7:00 PM stays 7:00 PM), so their times move. Not possible once tickets are sold.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toMatchObject({ timeZone: 'America/Chicago' });
  });
});

describe('the zone-change note (R14)', () => {
  it('is not shown on a venue without events', async () => {
    stubApi({
      [`GET ${PATH}`]: json(venue),
      [`GET ${PATH}/layout`]: json({ sections: [] }),
      'GET /events': json([]),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Rupp Arena'));
    set('Time zone', 'America/Chicago');
    // The venue's events have loaded (none): nothing moves, so nothing is said.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/keeps each event's local time/)).toBeNull();
  });

  it('is shown on a venue with events', async () => {
    stubApi({
      [`GET ${PATH}`]: json(venue),
      [`GET ${PATH}/layout`]: json({ sections: [] }),
      'GET /events': json([{ id: 'e1', name: 'Fall Concert' }]),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Rupp Arena'));
    set('Time zone', 'America/Chicago');
    expect(await screen.findByText(/keeps each event's local time/)).toBeInTheDocument();
  });
});

describe('a state with more than one zone (FR-003)', () => {
  it('after ADDRESS_NOT_FOUND in Kentucky, Save anyway needs Eastern or Central', async () => {
    const api = stubApi({
      'POST /locations': () =>
        writes(api).length === 1
          ? json(NOT_FOUND, 400)
          : json({ ...venue, addressVerified: false, timeZoneSource: 'ADMIN' }, 201),
      'GET /locations': json([venue]),
    });
    renderAt('/locations/new');
    fill();
    create();
    await screen.findByRole('button', { name: SAVE_ANYWAY });
    const group = screen.getByRole('group', { name: /Kentucky has more than one time zone/ });
    expect(group).toHaveTextContent(
      "Kentucky has more than one time zone. Choose this venue's time zone:",
    );
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
      'Eastern Time',
      'Central Time',
    ]);
    fireEvent.click(screen.getByRole('button', { name: SAVE_ANYWAY }));
    expect(await screen.findByText("Choose this venue's time zone first.")).toBeInTheDocument();
    expect(writes(api)).toHaveLength(1);

    fireEvent.click(within(group).getByLabelText('Eastern Time'));
    fireEvent.click(screen.getByRole('button', { name: SAVE_ANYWAY }));
    await waitFor(() => expect(writes(api)).toHaveLength(2));
    expect(writes(api)[1].body).toMatchObject({
      acceptUnverifiedAddress: true,
      timeZone: 'America/New_York',
    });
  });

  it('in Ohio, Save anyway asks nothing', async () => {
    const api = stubApi({
      'POST /locations': () => (writes(api).length === 1 ? json(NOT_FOUND, 400) : json(venue, 201)),
      'GET /locations': json([venue]),
    });
    renderAt('/locations/new');
    fill({ City: 'Columbus', State: 'OH', 'ZIP code': '43215' });
    create();
    await screen.findByRole('button', { name: SAVE_ANYWAY });
    expect(screen.queryByRole('group', { name: /more than one time zone/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SAVE_ANYWAY }));
    await waitFor(() => expect(writes(api)).toHaveLength(2));
    expect(writes(api)[1].body).not.toHaveProperty('timeZone');
  });

  it("shows TIME_ZONE_REQUIRED's zones and sends the choice", async () => {
    const required = {
      error: {
        code: 'TIME_ZONE_REQUIRED',
        message:
          "Tennessee has more than one time zone. Choose this venue's time zone: Central Time or Eastern Time.",
        details: { state: 'TN', timeZones: ['America/Chicago', 'America/New_York'] },
      },
    };
    const api = stubApi({
      'POST /locations': () => (writes(api).length === 1 ? json(required, 400) : json(venue, 201)),
      'GET /locations': json([venue]),
    });
    renderAt('/locations/new');
    fill({ City: 'Nashville', State: 'TN', 'ZIP code': '37201' });
    create();
    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveTextContent(required.error.message);
    const group = screen.getByRole('group', { name: /Tennessee has more than one time zone/ });
    fireEvent.click(within(group).getByLabelText('Central Time'));
    create();
    await waitFor(() => expect(writes(api)).toHaveLength(2));
    expect(writes(api)[1].body).toMatchObject({ timeZone: 'America/Chicago' });
  });

  it('changing the state clears the choice', async () => {
    const api = stubApi({ 'POST /locations': json(NOT_FOUND, 400) });
    renderAt('/locations/new');
    fill();
    create();
    await screen.findByRole('button', { name: SAVE_ANYWAY });
    fireEvent.click(screen.getByLabelText('Central Time'));
    set('State', 'IN');
    expect(screen.queryByLabelText('Central Time')).toBeNull();
    expect(writes(api)).toHaveLength(1);
  });

  it('on edit of a Kentucky venue stored in Eastern, Eastern starts selected (m4)', async () => {
    const stored = { ...venue, addressVerified: false, timeZoneSource: 'ADMIN' as const };
    stubApi({
      [`GET ${PATH}`]: json(stored),
      [`GET ${PATH}/layout`]: json({ sections: [] }),
      [`PATCH ${PATH}`]: json(NOT_FOUND, 400),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Rupp Arena'));
    set('Street address', '1 Arena Plaza');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('button', { name: SAVE_ANYWAY });
    expect(screen.getByLabelText('Eastern Time')).toBeChecked();
    expect(screen.getByLabelText('Central Time')).not.toBeChecked();
  });
});

describe('zone change refusals (FR-026)', () => {
  const edit = async (body: object, status: number) => {
    stubApi({
      [`GET ${PATH}`]: json(venue),
      [`GET ${PATH}/layout`]: json({ sections: [] }),
      [`PATCH ${PATH}`]: json(body, status),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Rupp Arena'));
    set('Time zone', 'America/Chicago');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    return screen.findByTestId('error-banner');
  };

  it('lists the events of TIME_ZONE_HAS_ORDERS as links, keeping every value', async () => {
    const banner = await edit(
      {
        error: {
          code: 'TIME_ZONE_HAS_ORDERS',
          message:
            "Can't change the time zone of Rupp Arena: tickets have been sold for 2 of its events. No customer's ticket time may move.",
          details: {
            timeZone: 'America/New_York',
            proposedTimeZone: 'America/Chicago',
            events: [
              { id: 'e1', name: 'Fall Concert' },
              { id: 'e2', name: 'Gala' },
            ],
            eventCount: 2,
          },
        },
      },
      409,
    );
    expect(banner).toHaveAttribute('data-code', 'TIME_ZONE_HAS_ORDERS');
    expect(within(banner).getByRole('link', { name: 'Fall Concert' })).toHaveAttribute(
      'href',
      '/events/e1',
    );
    expect(within(banner).getByRole('link', { name: 'Gala' })).toHaveAttribute(
      'href',
      '/events/e2',
    );
    expect(screen.getByLabelText('Time zone')).toHaveValue('America/Chicago');
    expect(screen.getByLabelText('Name')).toHaveValue('Rupp Arena');
  });

  it.each([
    [
      'EVENT_TIME_NOT_IN_ZONE',
      "Can't change the time zone: Late C's start, Mar 14, 2027, 2:30 AM, doesn't exist in Mountain Time.",
    ],
    ['SCHEDULING_CONFLICT', "Can't change the time zone: 'Late B' would start at …"],
  ])('shows %s in the banner, keeping every value', async (code, message) => {
    const banner = await edit({ error: { code, message, details: {} } }, 409);
    expect(banner).toHaveAttribute('data-code', code);
    expect(banner).toHaveTextContent(message);
    expect(screen.getByLabelText('Time zone')).toHaveValue('America/Chicago');
  });
});
