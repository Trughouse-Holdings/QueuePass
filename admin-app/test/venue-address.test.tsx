import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mapsUrl, type Location } from '@queuepass/shared';
import { LocationDetail } from '../src/pages/LocationDetail';
import { LocationForm } from '../src/pages/LocationForm';
import { LocationList } from '../src/pages/LocationList';
import { json, stubApi } from './helpers/api-stub';

/** Spec 013 US1 (FR-011 to FR-013, FR-019); research R13. */
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

  it('sends the four fields, with no address and no save-anyway flag', async () => {
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

describe('Address refusals and Save anyway', () => {
  it('shows ADDRESS_NOT_FOUND, keeps every value, and offers Save anyway', async () => {
    stubApi({ 'POST /locations': json(NOT_FOUND, 400) });
    renderAt('/locations/new');
    fill();
    create();
    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-code', 'ADDRESS_NOT_FOUND');
    expect(banner).toHaveTextContent(NOT_FOUND.error.message);
    expectValuesKept();
    expect(screen.getByRole('button', { name: SAVE_ANYWAY })).toBeInTheDocument();
  });

  it('shows ADDRESS_AMBIGUOUS with each candidate as a list item, and Save anyway', async () => {
    stubApi({ 'POST /locations': json(AMBIGUOUS, 400) });
    renderAt('/locations/new');
    fill();
    create();
    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveTextContent(AMBIGUOUS.error.message);
    const items = within(banner).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(CANDIDATES);
    expectValuesKept();
    expect(screen.getByRole('button', { name: SAVE_ANYWAY })).toBeInTheDocument();
  });

  it('shows a single different match as "did you mean", with Save anyway (FR-021)', async () => {
    const moved = {
      error: {
        code: 'ADDRESS_AMBIGUOUS',
        message:
          'We found a different US address for 1540 University Dr, Lexington, KY 40508. ' +
          'Did you mean this one? Enter it to use it.',
        details: {
          address: '1540 University Dr, Lexington, KY 40508',
          candidates: ['1540 UNIVERSITY CT, LEXINGTON, KY 40503'],
        },
      },
    };
    stubApi({ 'POST /locations': json(moved, 400) });
    renderAt('/locations/new');
    fill({
      Name: 'Kroger Field',
      'Street address': '1540 University Dr',
      City: 'Lexington',
      'ZIP code': '40508',
    });
    create();
    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveTextContent('Did you mean this one?');
    expect(
      within(banner)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1540 UNIVERSITY CT, LEXINGTON, KY 40503']);
    expect(field('Street address').value).toBe('1540 University Dr');
    expect(field('ZIP code').value).toBe('40508');
    expect(screen.getByRole('button', { name: SAVE_ANYWAY })).toBeInTheDocument();
  });

  it('resends the same values with the flag, and the list shows the not-verified notice', async () => {
    let n = 0;
    const api = stubApi({
      'POST /locations': () => (n++ === 0 ? json(NOT_FOUND, 400) : json(savedAnyway, 201)),
      'GET /locations': json([savedAnyway]),
    });
    renderAt('/locations/new');
    fill();
    create();
    await screen.findByRole('button', { name: SAVE_ANYWAY });
    // Spec 020 FR-003: Kentucky has two time zones, so Save anyway needs one chosen.
    fireEvent.click(screen.getByLabelText('Eastern Time'));
    fireEvent.click(screen.getByRole('button', { name: SAVE_ANYWAY }));

    expect(
      await screen.findByText(
        // Spec 020 R14: the notice also names the zone (the fixture has none: the default).
        'Venue saved. Address (not verified): 1 Arena Plaza, Louisville, KY 40202. Time zone: Eastern Time, the default.',
      ),
    ).toBeInTheDocument();
    const [first, second] = writes(api);
    expect(second.body).toEqual({
      ...(first.body as object),
      acceptUnverifiedAddress: true,
      timeZone: 'America/New_York',
    });
    expect(first.body).not.toHaveProperty('acceptUnverifiedAddress');
  });

  it.each(['Street address', 'City', 'State', 'ZIP code'])(
    'hides Save anyway again when %s changes',
    async (label) => {
      stubApi({ 'POST /locations': json(NOT_FOUND, 400) });
      renderAt('/locations/new');
      fill();
      create();
      await screen.findByRole('button', { name: SAVE_ANYWAY });
      set(label, label === 'State' ? 'IN' : `${field(label).value}1`);
      expect(screen.queryByRole('button', { name: SAVE_ANYWAY })).toBeNull();
    },
  );

  it('does not offer Save anyway for VALIDATION_FAILED', async () => {
    stubApi({
      'POST /locations': json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: { fields: ['name must be between 1 and 200 characters'] },
          },
        },
        400,
      ),
    });
    renderAt('/locations/new');
    fill();
    create();
    await screen.findByTestId('error-banner');
    expect(screen.queryByRole('button', { name: SAVE_ANYWAY })).toBeNull();
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
    expect(
      await screen.findByText(
        'Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507. Time zone: Eastern Time, the default.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Venues' })).toBeInTheDocument();
  });
});

describe('Editing a venue address', () => {
  it('prefills the four fields from the venue and sends all four', async () => {
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
    expect(writes(api)[0].body).toEqual({
      name: 'Rupp Arena at Central Bank Center',
      street: '430 W VINE ST',
      city: 'LEXINGTON',
      state: 'KY',
      zip: '40507',
      seatingCapacity: 20500,
    });
  });

  it('sends a laid-out venue its name and four fields, never capacity or address', async () => {
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
    expect(writes(api)[0].body).toEqual({
      name: 'Rupp Arena',
      street: '430 W VINE ST',
      city: 'LEXINGTON',
      state: 'KY',
      zip: '40507',
    });
  });
});

describe('Seated venue in one step', () => {
  const addSection = () => {
    fireEvent.click(screen.getByRole('radio', { name: 'Seated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 1 name' }), {
      target: { value: 'A' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Section 1 rows' }), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Section 1 seats per row' }), {
      target: { value: '10' },
    });
  };

  it('sends no layout when the address is refused, and the layout after Save anyway', async () => {
    let n = 0;
    const api = stubApi({
      'POST /locations': () => (n++ === 0 ? json(NOT_FOUND, 400) : json(savedAnyway, 201)),
      [`PUT ${PATH}/layout`]: json({ locationId: ID, totalSeats: 20, sections: [] }),
      'GET /locations': json([savedAnyway]),
    });
    renderAt('/locations/new');
    fill({ 'Seating capacity': undefined });
    addSection();
    create();
    await screen.findByRole('button', { name: SAVE_ANYWAY });
    expect(writes(api).map((c) => c.method)).toEqual(['POST']);

    // Spec 020 FR-003: Kentucky has two time zones, so Save anyway needs one chosen.
    fireEvent.click(screen.getByLabelText('Eastern Time'));
    fireEvent.click(screen.getByRole('button', { name: SAVE_ANYWAY }));
    await screen.findByText(/Venue saved\. Address \(not verified\)/);
    expect(writes(api).map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /locations',
      'POST /locations',
      `PUT ${PATH}/layout`,
    ]);
  });
});

describe('The address service is down (US2)', () => {
  const MESSAGE = UNAVAILABLE.error.message;

  it('shows the try-again message on create, keeps every value, and offers no Save anyway', async () => {
    stubApi({ 'POST /locations': json(UNAVAILABLE, 503) });
    renderAt('/locations/new');
    fill();
    create();
    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveTextContent(MESSAGE);
    expectValuesKept();
    expect(screen.queryByRole('button', { name: SAVE_ANYWAY })).toBeNull();
  });

  it('shows the same on edit, with no Save anyway', async () => {
    stubApi({
      [`GET ${PATH}`]: json(verified),
      [`PATCH ${PATH}`]: json(UNAVAILABLE, 503),
    });
    renderAt(`${PATH}/edit`);
    await waitFor(() => expect(field('Street address').value).toBe('430 W VINE ST'));
    set('Street address', '1 Nowhere Blvd');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(MESSAGE);
    expect(field('Street address').value).toBe('1 Nowhere Blvd');
    expect(screen.queryByRole('button', { name: SAVE_ANYWAY })).toBeNull();
  });

  it('hides Save anyway when pressing it meets a 503', async () => {
    let n = 0;
    stubApi({
      'POST /locations': () => (n++ === 0 ? json(NOT_FOUND, 400) : json(UNAVAILABLE, 503)),
    });
    renderAt('/locations/new');
    fill();
    create();
    await screen.findByRole('button', { name: SAVE_ANYWAY });
    // Spec 020 FR-003: Kentucky has two time zones, so Save anyway needs one chosen.
    fireEvent.click(screen.getByLabelText('Eastern Time'));
    fireEvent.click(screen.getByRole('button', { name: SAVE_ANYWAY }));
    await waitFor(() => expect(screen.getByTestId('error-banner')).toHaveTextContent(MESSAGE));
    expect(screen.queryByRole('button', { name: SAVE_ANYWAY })).toBeNull();
    expectValuesKept();
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

  it('says a saved-anyway venue is not verified above its prefilled fields', async () => {
    stubApi({ [`GET ${PATH}`]: json(savedAnyway) });
    renderAt(`${PATH}/edit`);
    const note = await screen.findByText('This address is not verified.');
    expect(note).toHaveClass('note');
    await waitFor(() => expect(field('Street address').value).toBe('1 Arena Plaza'));
  });
});
