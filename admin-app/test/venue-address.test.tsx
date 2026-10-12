import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Location } from '@queuepass/shared';
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

  it('resends the same values with the flag, and the list shows the not-verified notice', async () => {
    let n = 0;
    const api = stubApi({
      'POST /locations': () => (n++ === 0 ? json(NOT_FOUND, 400) : json(savedAnyway, 201)),
      'GET /locations': json([savedAnyway]),
    });
    renderAt('/locations/new');
    fill();
    create();
    fireEvent.click(await screen.findByRole('button', { name: SAVE_ANYWAY }));

    expect(
      await screen.findByText(
        'Venue saved. Address (not verified): 1 Arena Plaza, Louisville, KY 40202.',
      ),
    ).toBeInTheDocument();
    const [first, second] = writes(api);
    expect(second.body).toEqual({
      ...(first.body as object),
      acceptUnverifiedAddress: true,
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
      await screen.findByText('Venue saved. Address: 430 W VINE ST, LEXINGTON, KY 40507.'),
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

    fireEvent.click(screen.getByRole('button', { name: SAVE_ANYWAY }));
    await screen.findByText(/Venue saved\. Address \(not verified\)/);
    expect(writes(api).map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /locations',
      'POST /locations',
      `PUT ${PATH}/layout`,
    ]);
  });
});
