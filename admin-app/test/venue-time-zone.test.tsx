import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Location } from '@queuepass/shared';
import { LocationDetail } from '../src/pages/LocationDetail';
import { LocationForm } from '../src/pages/LocationForm';
import { LocationList } from '../src/pages/LocationList';
import { json, stubApi } from './helpers/api-stub';

/**
 * Spec 020 US4, US5 (FR-004, FR-024, FR-026; research R14): the venue's zone on the list, the
 * venue page, and the form; zone-change refusals. Spec 024 US1 (FR-001 to FR-006; research R1,
 * R3): the admin picks the zone, required on create, the stored one on edit; no split-state
 * question; what an edit sends.
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

const ZONES = [
  'Eastern Time',
  'Central Time',
  'Mountain Time',
  'Arizona Time (no daylight saving)',
  'Pacific Time',
  'Alaska Time',
  'Hawaii-Aleutian Time',
  'Hawaii Time',
];
const ZONE_PROBLEM = "Choose the venue's time zone.";
const ADDRESS_HINT =
  "Changing the address doesn't change the time zone. Choose another zone here if the venue is in a different one.";
const RECORDS_ADMIN = 'Saving records Eastern Time as chosen by an admin.';
const options = () =>
  within(screen.getByLabelText('Time zone'))
    .getAllByRole('option')
    .map((o) => o.textContent);
const loadEdit = async (stored: Location, extra: Record<string, Response> = {}) => {
  const api = stubApi({
    [`GET ${PATH}`]: json(stored),
    [`GET ${PATH}/layout`]: json({ sections: [] }),
    [`PATCH ${PATH}`]: json(stored),
    'GET /locations': json([stored]),
    ...extra,
  });
  renderAt(`${PATH}/edit`);
  await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(stored.name));
  return api;
};
const saveChanges = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

describe('New venue: the admin picks the zone (spec 024 US1, FR-001, FR-002, FR-005)', () => {
  it('offers "Choose a time zone" and the eight zones, nothing that works one out', () => {
    stubApi({});
    renderAt('/locations/new');
    expect(options()).toEqual(['Choose a time zone', ...ZONES]);
    expect(screen.getByLabelText('Time zone')).toHaveValue('');
    expect(options().some((o) => /work it out/i.test(o ?? ''))).toBe(false);
    expect(
      screen.getByText('Event times at this venue are shown and entered in this zone.'),
    ).toBeInTheDocument();
  });

  it('sends nothing without a zone, says so by the field, and sends the zone once chosen', async () => {
    const api = stubApi({ 'POST /locations': json(venue, 201), 'GET /locations': json([venue]) });
    renderAt('/locations/new');
    fill();
    create();
    const problem = screen.getByRole('alert');
    expect(problem).toHaveTextContent(ZONE_PROBLEM);
    const select = screen.getByLabelText('Time zone');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select.getAttribute('aria-describedby')?.split(' ')).toContain(problem.id);
    expect(screen.getByLabelText('Name')).toHaveValue('KFC Yum! Center');
    expect(screen.getByLabelText('Street address')).toHaveValue('1 Arena Plaza');
    expect(screen.getByLabelText('Seating capacity')).toHaveValue(22090);
    await new Promise((r) => setTimeout(r, 20));
    expect(writes(api)).toHaveLength(0);

    set('Time zone', 'America/Chicago');
    expect(screen.queryByText(ZONE_PROBLEM)).toBeNull();
    expect(screen.getByLabelText('Time zone')).not.toHaveAttribute('aria-invalid');
    create();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toMatchObject({ timeZone: 'America/Chicago' });
  });

  it('describes the select with the problem and the hint on New venue', () => {
    stubApi({});
    renderAt('/locations/new');
    const select = screen.getByLabelText('Time zone');
    expect(select).toHaveAccessibleDescription(
      'Event times at this venue are shown and entered in this zone.',
    );
    fill();
    create();
    expect(select).toHaveAccessibleDescription(
      `${ZONE_PROBLEM} Event times at this venue are shown and entered in this zone.`,
    );
  });

  it('names the zone problem and the address problems in the same press', () => {
    const api = stubApi({});
    renderAt('/locations/new');
    fill({ 'ZIP code': '4050' });
    create();
    expect(screen.getByText(ZONE_PROBLEM)).toBeInTheDocument();
    expect(screen.getByText('Check the address')).toBeInTheDocument();
    expect(writes(api)).toHaveLength(0);
  });

  it('names the zone and its source in the saved notice', async () => {
    stubApi({
      'POST /locations': json({ ...venue, timeZoneSource: 'ADMIN' }, 201),
      'GET /locations': json([venue]),
    });
    renderAt('/locations/new');
    fill();
    set('Time zone', 'America/New_York');
    create();
    expect(
      await screen.findByText(
        'Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507. Time zone: Eastern Time, chosen by an admin.',
      ),
    ).toBeInTheDocument();
  });

  // FR-006, US1 scenario 8: the form no longer asks a state's zones; a refusal is just shown.
  it('asks no second question in Kentucky, whatever the response, and offers no Save anyway', async () => {
    stubApi({ 'POST /locations': json(NOT_FOUND, 400) });
    renderAt('/locations/new');
    fill();
    set('Time zone', 'America/New_York');
    create();
    await screen.findByTestId('error-banner');
    expect(screen.queryByRole('group', { name: /more than one time zone/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save anyway/ })).toBeNull();
  });
});

describe('Edit venue: the stored zone (spec 024 US1, FR-003, FR-004)', () => {
  it('starts on the stored zone, says how it was set, and offers only the eight', async () => {
    await loadEdit(venue);
    expect(options()).toEqual(ZONES);
    expect(screen.getByLabelText('Time zone')).toHaveValue('America/New_York');
    expect(screen.getByText('Eastern Time, from the address.')).toBeInTheDocument();
  });

  it('says an address change does not change the zone, and that saving records it', async () => {
    await loadEdit(venue);
    expect(screen.queryByText(ADDRESS_HINT)).toBeNull();
    expect(screen.queryByText(RECORDS_ADMIN)).toBeNull();
    set('City', 'Louisville');
    expect(screen.getByText(ADDRESS_HINT)).toBeInTheDocument();
    expect(screen.getByText(RECORDS_ADMIN)).toBeInTheDocument();
    set('City', 'LEXINGTON');
    expect(screen.queryByText(ADDRESS_HINT)).toBeNull();
    expect(screen.queryByText(RECORDS_ADMIN)).toBeNull();
  });

  // Spec 024 review round 1, minor 6: the hints describe the select for assistive technology.
  it('describes the select with the zone line and the hints shown', async () => {
    await loadEdit(venue);
    const select = screen.getByLabelText('Time zone');
    expect(select).toHaveAccessibleDescription('Eastern Time, from the address.');
    set('City', 'Louisville');
    expect(select).toHaveAccessibleDescription(
      `Eastern Time, from the address. ${ADDRESS_HINT} ${RECORDS_ADMIN}`,
    );
  });

  it('on a zone an admin chose, says only that the address does not change it', async () => {
    await loadEdit({ ...venue, timeZoneSource: 'ADMIN' });
    set('City', 'Louisville');
    expect(screen.getByText(ADDRESS_HINT)).toBeInTheDocument();
    expect(screen.queryByText(/as chosen by an admin\.$/)).toBeNull();
  });
});

describe('What an edit sends (spec 024 research R3, FR-005)', () => {
  it('a verified venue, name only: neither the address nor the zone', async () => {
    const api = await loadEdit(venue);
    set('Name', 'Rupp Arena II');
    saveChanges();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toEqual({ name: 'Rupp Arena II', seatingCapacity: 20500 });
  });

  it('a verified venue, street changed: the four fields, the flag, and the zone shown', async () => {
    const api = await loadEdit(venue);
    set('Street address', '431 W Vine St');
    saveChanges();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toEqual({
      name: 'Rupp Arena',
      street: '431 W Vine St',
      city: 'LEXINGTON',
      state: 'KY',
      zip: '40507',
      acceptUnverifiedAddress: true,
      timeZone: 'America/New_York',
      seatingCapacity: 20500,
    });
  });

  it('a not-verified venue, name only: the four fields as loaded, the flag, and the zone', async () => {
    const api = await loadEdit({ ...venue, addressVerified: false, timeZoneSource: 'STATE' });
    expect(screen.getByText(RECORDS_ADMIN)).toBeInTheDocument();
    set('Name', 'Rupp Arena II');
    saveChanges();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toEqual({
      name: 'Rupp Arena II',
      street: '430 W VINE ST',
      city: 'LEXINGTON',
      state: 'KY',
      zip: '40507',
      acceptUnverifiedAddress: true,
      timeZone: 'America/New_York',
      seatingCapacity: 20500,
    });
  });

  it('any venue, zone changed: the new zone, with the zone-change note', async () => {
    const api = await loadEdit(venue, {
      [`PATCH ${PATH}`]: json({ ...venue, timeZone: 'America/Chicago', timeZoneSource: 'ADMIN' }),
    });
    expect(screen.queryByText(/keeps each event's local time/)).toBeNull();
    set('Time zone', 'America/Chicago');
    expect(
      screen.getByText(
        "Changing the time zone keeps each event's local time (7:00 PM stays 7:00 PM), so their times move. Not possible once tickets are sold.",
      ),
    ).toBeInTheDocument();
    saveChanges();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toEqual({
      name: 'Rupp Arena',
      timeZone: 'America/Chicago',
      seatingCapacity: 20500,
    });
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
