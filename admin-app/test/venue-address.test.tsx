import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mapsUrl, type Location } from '@queuepass/shared';
import { LocationDetail } from '../src/pages/LocationDetail';
import { LocationForm } from '../src/pages/LocationForm';
import { LocationList } from '../src/pages/LocationList';
import { json, stubApi } from './helpers/api-stub';

/**
 * Spec 013 US1 (FR-012, FR-013, FR-019); research R13. Spec 024 US2 (FR-008 to FR-017; research
 * R3, R4, R6): no Save anyway; the flag with every address sent; the not-verified notice.
 */
afterEach(() => vi.unstubAllGlobals());

const ID = '6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e';
const PATH = `/locations/${ID}`;

const verified: Location = {
  id: ID,
  name: 'Rupp Arena',
  address: '430 W VINE ST, LEXINGTON, KY 40507',
  street: '430 W VINE ST',
  city: 'LEXINGTON',
  state: 'KY',
  zip: '40507',
  addressVerified: true,
  seatingCapacity: 20500,
  createdAt: '2026-10-11T12:00:00.000Z',
  updatedAt: '2026-10-11T12:00:00.000Z',
};
const savedAnyway: Location = {
  ...verified,
  name: 'KFC Yum! Center',
  address: '1 Arena Plaza, Louisville, KY 40202',
  street: '1 Arena Plaza',
  city: 'Louisville',
  state: 'KY',
  zip: '40202',
  addressVerified: false,
};
const legacy: Location = {
  ...verified,
  name: 'Demo Arena',
  address: '1 Demo Plaza, Louisville, KY',
  street: null,
  city: null,
  state: null,
  zip: null,
  addressVerified: false,
};

const NOT_FOUND = {
  error: {
    code: 'ADDRESS_NOT_FOUND',
    message:
      "We couldn't find 1 Arena Plaza, Louisville, KY 40202 as a US address. Check the street, city, state, and ZIP code.",
    details: { address: '1 Arena Plaza, Louisville, KY 40202' },
  },
};
const CANDIDATES = ['100 N MAIN ST, SPRINGFIELD, IL 62701', '100 S MAIN ST, SPRINGFIELD, IL 62701'];
const AMBIGUOUS = {
  error: {
    code: 'ADDRESS_AMBIGUOUS',
    message:
      '100 Main St, Springfield, IL 62701 matches more than one US address. Enter one of these.',
    details: { address: '100 Main St, Springfield, IL 62701', candidates: CANDIDATES },
  },
};
const UNAVAILABLE = {
  error: {
    code: 'ADDRESS_SERVICE_UNAVAILABLE',
    message: "We can't verify the address right now. Nothing was saved. Try again in a minute.",
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

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const set = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fill(values: Partial<Record<string, string>> = {}): void {
  const v = {
    Name: 'KFC Yum! Center',
    'Street address': '1 Arena Plaza',
    City: 'Louisville',
    State: 'KY',
    'ZIP code': '40202',
    'Seating capacity': '22090',
    // Spec 024 FR-002: a new venue needs its zone chosen.
    'Time zone': 'America/New_York',
    ...values,
  };
  for (const [label, value] of Object.entries(v)) set(label, value ?? '');
}

const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));
const writes = (api: ReturnType<typeof stubApi>) => api.calls.filter((c) => c.method !== 'GET');

function expectValuesKept(): void {
  expect(field('Name').value).toBe('KFC Yum! Center');
  expect(field('Street address').value).toBe('1 Arena Plaza');
  expect(field('City').value).toBe('Louisville');
  expect(field('State').value).toBe('KY');
  expect(field('ZIP code').value).toBe('40202');
  expect(field('Seating capacity').value).toBe('22090');
}

describe('Venue form address fields', () => {
  it('has Street address, City, a State list, and ZIP code, each labelled', () => {
    stubApi({});
    renderAt('/locations/new');
    for (const label of ['Street address', 'City', 'State', 'ZIP code']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Address')).toBeNull();
    const options = within(screen.getByLabelText('State')).getAllByRole('option');
    expect(options).toHaveLength(52);
    expect(options[0]).toHaveTextContent('Choose a state');
    expect(screen.getByRole('option', { name: 'Kentucky (KY)' })).toBeInTheDocument();
  });

  it('sends the four fields and the flag (spec 024 R4), with no one-line address', async () => {
    const api = stubApi({ 'POST /locations': json(savedAnyway, 201), 'GET /locations': json([]) });
    renderAt('/locations/new');
    fill();
    create();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toEqual({
      name: 'KFC Yum! Center',
      street: '1 Arena Plaza',
      city: 'Louisville',
      state: 'KY',
      zip: '40202',
      acceptUnverifiedAddress: true,
      timeZone: 'America/New_York',
      seatingCapacity: 22090,
    });
  });

  it.each([
    ['a blank street', { 'Street address': '' }, /Street address/],
    ['a blank city', { City: '   ' }, /City/],
    ['no state', { State: '' }, /state/],
    ['a 4-digit ZIP code', { 'ZIP code': '4050' }, /ZIP code/],
  ])('refuses %s before sending, naming the field', (_label, change, named) => {
    const api = stubApi({});
    renderAt('/locations/new');
    fill(change);
    create();
    expect(screen.getByRole('alert')).toHaveTextContent(named);
    expect(writes(api)).toHaveLength(0);
    expect(field('Name').value).toBe('KFC Yum! Center');
  });

  it('sends a ZIP+4', async () => {
    const api = stubApi({ 'POST /locations': json(verified, 201), 'GET /locations': json([]) });
    renderAt('/locations/new');
    fill({ 'ZIP code': '40507-1234' });
    create();
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect((writes(api)[0].body as { zip: string }).zip).toBe('40507-1234');
  });
});

/** Spec 024 research R6: the notice after a save whose address is not verified. */
const NOT_VERIFIED_NOTICE =
  'Venue saved, but its address is not verified: 1 Arena Plaza, Louisville, KY 40202. The US ' +
  "address service couldn't confirm it, so check that it's right: customers see this address " +
  "and its map link. To verify it later, edit the venue and save it, correcting the address if it's " +
  'wrong. Time zone: Eastern Time, chosen by an admin.';
const notVerified: Location = {
  ...savedAnyway,
  timeZone: 'America/New_York',
  timeZoneSource: 'ADMIN',
};

describe('One press saves the address (spec 024 US2, FR-008 to FR-011, FR-014, FR-015)', () => {
  it.each([
    ['400 ADDRESS_NOT_FOUND', NOT_FOUND, 400],
    ['400 ADDRESS_AMBIGUOUS', AMBIGUOUS, 400],
    [
      '400 VALIDATION_FAILED',
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed.',
          details: { fields: ['name must be between 1 and 200 characters'] },
        },
      },
      400,
    ],
    ['503 ADDRESS_SERVICE_UNAVAILABLE', UNAVAILABLE, 503],
  ])(
    'shows a %s refusal, keeps every value, and offers no Save anyway',
    async (_l, body, status) => {
      stubApi({ 'POST /locations': json(body, status) });
      renderAt('/locations/new');
      fill();
      create();
      const banner = await screen.findByTestId('error-banner');
      expect(banner).toHaveTextContent(body.error.message);
      expectValuesKept();
      expect(screen.queryByRole('button', { name: SAVE_ANYWAY })).toBeNull();
    },
  );

  it('shows ADDRESS_AMBIGUOUS with each candidate as a list item', async () => {
    stubApi({ 'POST /locations': json(AMBIGUOUS, 400) });
    renderAt('/locations/new');
    fill();
    create();
    const banner = await screen.findByTestId('error-banner');
    const items = within(banner).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(CANDIDATES);
  });

  it.each([
    ['not verified', notVerified],
    ['verified', { ...verified, timeZone: 'America/New_York', timeZoneSource: 'ADMIN' as const }],
  ])('offers no Save anyway after a %s save', async (_l, saved) => {
    stubApi({ 'POST /locations': json(saved, 201), 'GET /locations': json([saved]) });
    renderAt('/locations/new');
    fill();
    create();
    await screen.findByRole('heading', { name: 'Venues' });
    expect(screen.queryByRole('button', { name: SAVE_ANYWAY })).toBeNull();
  });

  it('after a not-verified save, says so in a plain notice: why, and how to verify it', async () => {
    const api = stubApi({
      'POST /locations': json(notVerified, 201),
      'GET /locations': json([notVerified]),
    });
    renderAt('/locations/new');
    fill();
    create();
    const notice = await screen.findByText(NOT_VERIFIED_NOTICE);
    const status = notice.closest('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(status).not.toHaveClass('banner--success');
    expect(screen.queryByTestId('success-state')).toBeNull();
    // One press, one request.
    expect(writes(api)).toHaveLength(1);
  });

  it('after a verified save, goes to the list with the saved address from the response', async () => {
    stubApi({ 'POST /locations': json(verified, 201), 'GET /locations': json([verified]) });
    renderAt('/locations/new');
    fill({
      Name: 'Rupp Arena',
      'Street address': '430 W Vine St',
      City: 'Lexington',
      'ZIP code': '40507',
    });
    create();
    const notice = await screen.findByText(
      'Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507. Time zone: Eastern Time, the default.',
    );
    expect(notice.closest('[data-testid="success-state"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Venues' })).toBeInTheDocument();
  });
});

describe('What a save sends with the address (spec 024 research R3, R4)', () => {
  it('sends the flag with the address on an edit that changes it', async () => {
    const api = stubApi({
      [`GET ${PATH}`]: json(verified),
      [`PATCH ${PATH}`]: json(verified),
      'GET /locations': json([verified]),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(field('Street address').value).toBe('430 W VINE ST'));
    set('Street address', '1 Nowhere Blvd');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toMatchObject({
      street: '1 Nowhere Blvd',
      acceptUnverifiedAddress: true,
    });
  });

  it('sends a not-verified venue its address again with the flag, so it is checked again', async () => {
    const api = stubApi({
      [`GET ${PATH}`]: json(notVerified),
      [`PATCH ${PATH}`]: json(notVerified),
      'GET /locations': json([notVerified]),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(field('Street address').value).toBe('1 Arena Plaza'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toMatchObject({
      street: '1 Arena Plaza',
      city: 'Louisville',
      state: 'KY',
      zip: '40202',
      acceptUnverifiedAddress: true,
    });
  });

  it('sends neither the address nor the flag on a verified venue name edit', async () => {
    const api = stubApi({
      [`GET ${PATH}`]: json(verified),
      [`PATCH ${PATH}`]: json(verified),
      'GET /locations': json([verified]),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(field('Street address').value).toBe('430 W VINE ST'));
    set('Name', 'Rupp');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).not.toHaveProperty('street');
    expect(writes(api)[0].body).not.toHaveProperty('acceptUnverifiedAddress');
  });
});

describe('Editing a venue address', () => {
  it('prefills the four fields from the venue, and a name edit sends none of them (024 R3)', async () => {
    const api = stubApi({
      [`GET ${PATH}`]: json(verified),
      [`PATCH ${PATH}`]: json(verified),
      'GET /locations': json([verified]),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(field('Street address').value).toBe('430 W VINE ST'));
    expect(field('City').value).toBe('LEXINGTON');
    expect(field('State').value).toBe('KY');
    expect(field('ZIP code').value).toBe('40507');

    set('Name', 'Rupp Arena at Central Bank Center');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    // Spec 024 research R3: a verified venue's unchanged address is not sent.
    expect(writes(api)[0].body).toEqual({
      name: 'Rupp Arena at Central Bank Center',
      seatingCapacity: 20500,
    });
  });

  it('sends a laid-out verified venue its name only, never capacity or address (024 R3)', async () => {
    const api = stubApi({
      [`GET ${PATH}`]: json(verified),
      [`GET ${PATH}/layout`]: json({
        locationId: ID,
        totalSeats: 20,
        sections: [{ id: 's', name: 'A', rows: 2, seatsPerRow: 10 }],
      }),
      [`PATCH ${PATH}`]: json(verified),
      'GET /locations': json([verified]),
    });
    renderAt(`${PATH}/edit`);
    await screen.findByText(/set by its seating layout/);
    await waitFor(() => expect(field('Street address').value).toBe('430 W VINE ST'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toEqual({ name: 'Rupp Arena' });
  });
});

describe('Seated venue in one step', () => {
  const addSection = () => {
    fireEvent.click(screen.getByRole('radio', { name: 'Seated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 1 Section name' }), {
      target: { value: 'A' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Section 1 Rows' }), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Section 1 Seats per row' }), {
      target: { value: '10' },
    });
  };

  it('saves the layout of a venue whose address is not verified (008 FR-017)', async () => {
    const api = stubApi({
      'POST /locations': json(notVerified, 201),
      [`PUT ${PATH}/layout`]: json({ locationId: ID, totalSeats: 20, sections: [] }),
      'GET /locations': json([notVerified]),
    });
    renderAt('/locations/new');
    fill({ 'Seating capacity': undefined });
    addSection();
    create();
    await screen.findByText(NOT_VERIFIED_NOTICE);
    expect(writes(api).map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /locations',
      `PUT ${PATH}/layout`,
    ]);
    expect(writes(api)[0].body).toMatchObject({ acceptUnverifiedAddress: true });
  });
});

describe('The address service is down (US2)', () => {
  it('shows a 503 on edit in the banner, keeping every value, with no Save anyway', async () => {
    stubApi({
      [`GET ${PATH}`]: json(verified),
      [`PATCH ${PATH}`]: json(UNAVAILABLE, 503),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(field('Street address').value).toBe('430 W VINE ST'));
    set('Street address', '1 Nowhere Blvd');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(UNAVAILABLE.error.message);
    expect(field('Street address').value).toBe('1 Nowhere Blvd');
    expect(screen.queryByRole('button', { name: SAVE_ANYWAY })).toBeNull();
  });
});

describe('Venue addresses as map links (US3)', () => {
  const label = (address: string) => `${address} (opens Google Maps in a new tab)`;
  const expectMapLink = async (address: string) => {
    const link = await screen.findByRole('link', { name: label(address) });
    expect(link).toHaveAttribute('href', mapsUrl(address));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  };

  it('links each address on the venue list, including a venue from before 013', async () => {
    stubApi({ 'GET /locations': json([verified, savedAnyway, legacy]) });
    renderAt('/locations');
    for (const v of [verified, savedAnyway, legacy]) await expectMapLink(v.address);
  });

  it('links the address on the venue page', async () => {
    stubApi({ [`GET ${PATH}`]: json(verified), 'GET /events': json([]) });
    renderAt(PATH);
    await expectMapLink(verified.address);
  });
});

describe('Venues whose address is not verified (US4, FR-017)', () => {
  const MARK = 'Address not verified. Edit the venue to verify it.';
  const noStyle = (el: HTMLElement) => {
    expect(el).not.toHaveAttribute('style');
    for (const child of Array.from(el.querySelectorAll('*'))) {
      expect(child).not.toHaveAttribute('style');
    }
  };

  it('marks each not-verified venue "Not verified" in a pill on the list, not a verified one', async () => {
    stubApi({ 'GET /locations': json([verified, savedAnyway, legacy]) });
    renderAt('/locations');
    await screen.findByText(verified.name);
    const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;

    for (const v of [savedAnyway, legacy]) {
      const pill = within(rowOf(v.name)).getByText('Not verified');
      expect(pill).toHaveClass('pill');
      noStyle(pill);
    }
    expect(within(rowOf(verified.name)).queryByText('Not verified')).toBeNull();
  });

  it.each([
    ['saved anyway', savedAnyway],
    ['from before 013', legacy],
  ])('marks a venue %s on its page in a note', async (_label, v) => {
    stubApi({ [`GET ${PATH}`]: json(v), 'GET /events': json([]) });
    renderAt(PATH);
    const note = await screen.findByText(MARK);
    expect(note).toHaveClass('note');
    noStyle(note);
  });

  it('does not mark a verified venue on its page', async () => {
    stubApi({ [`GET ${PATH}`]: json(verified), 'GET /events': json([]) });
    renderAt(PATH);
    await screen.findByRole('heading', { name: verified.name });
    expect(screen.queryByText(MARK)).toBeNull();
  });

  it('shows a legacy venue its old address above empty fields, and sends no address when they stay empty', async () => {
    const api = stubApi({
      [`GET ${PATH}`]: json(legacy),
      [`PATCH ${PATH}`]: json({ ...legacy, name: 'Demo Arena II' }),
      'GET /locations': json([legacy]),
    });
    renderAt(`${PATH}/edit`);
    const note = await screen.findByText(
      'Current address (not verified): 1 Demo Plaza, Louisville, KY. Enter it below to verify it.',
    );
    expect(note).toHaveClass('note');
    await waitFor(() => expect(field('Name').value).toBe('Demo Arena'));
    for (const label of ['Street address', 'City', 'State', 'ZIP code']) {
      expect(field(label).value).toBe('');
    }

    set('Name', 'Demo Arena II');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0].body).toEqual({ name: 'Demo Arena II', seatingCapacity: 20500 });
  });

  it('requires all four once a legacy venue address field is filled in', async () => {
    const api = stubApi({ [`GET ${PATH}`]: json(legacy) });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(field('Name').value).toBe('Demo Arena'));
    set('Street address', '937 Phillips Ln');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('City');
    expect(alert).toHaveTextContent('ZIP code');
    expect(writes(api)).toHaveLength(0);
  });

  it('says a saved-anyway venue is not verified, and that saving checks it again (024 FR-017)', async () => {
    stubApi({ [`GET ${PATH}`]: json(savedAnyway) });
    renderAt(`${PATH}/edit`);
    const note = await screen.findByText('This address is not verified. Saving checks it again.');
    expect(note).toHaveClass('note');
    await waitFor(() => expect(field('Street address').value).toBe('1 Arena Plaza'));
  });
});
