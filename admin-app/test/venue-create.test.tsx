import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocationForm } from '../src/pages/LocationForm';
import { json, stubApi } from './helpers/api-stub';
import { VENUE } from './fixtures-005';
import { chooseLayoutFile, layoutFile } from './helpers/layout-file';

/**
 * 2026-11-19 (in place of spec 008 US5 and 038 T019's section lines): a new venue is made from a
 * layout file, required, in one step: the venue with the file's seats as its capacity, then the
 * file imported. No capacity is typed and there is no general-admission-only venue.
 */
afterEach(() => vi.unstubAllGlobals());

const IMPORT_PATH = `/locations/${VENUE.id}/layouts/import`;

const renderNew = () =>
  render(
    <MemoryRouter initialEntries={['/locations/new']}>
      <Routes>
        <Route path="/locations/new" element={<LocationForm />} />
        <Route path="/locations" element={<p>Venue list</p>} />
      </Routes>
    </MemoryRouter>,
  );

const fillNameAndAddress = () => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Seat Hall' } });
  // Spec 013: the address is four fields.
  fireEvent.change(screen.getByLabelText('Street address'), { target: { value: '1 Seat St' } });
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Louisville' } });
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'KY' } });
  fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '40202' } });
  // Spec 024 FR-002: a new venue needs its zone chosen.
  fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } });
};
const SENT_ADDRESS = { street: '1 Seat St', city: 'Louisville', state: 'KY', zip: '40202' };
// Spec 024 research R3, R4: a create sends the chosen zone and the save-even-if-unverified flag.
const SENT_ZONE = { acceptUnverifiedAddress: true, timeZone: 'America/New_York' };

describe('New venue: from a layout file', () => {
  it('outlines each required field with no valid value in red at once, until it has one', () => {
    stubApi({});
    renderNew();
    const fields = ['Name', 'Street address', 'City', 'State', 'ZIP code', 'Time zone'];
    for (const label of fields) expect(screen.getByLabelText(label)).toHaveClass('input--needed');
    expect(screen.getByLabelText('Layout file')).toHaveClass('input--needed');
    expect(screen.queryByRole('alert')).toBeNull();

    fillNameAndAddress();
    for (const label of fields) {
      expect(screen.getByLabelText(label)).not.toHaveClass('input--needed');
    }
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '402' } });
    expect(screen.getByLabelText('ZIP code')).toHaveClass('input--needed');
    chooseLayoutFile();
    expect(screen.getByLabelText('Layout file')).not.toHaveClass('input--needed');
  });

  it('asks for a layout file, not a capacity, General admission or section lines', () => {
    stubApi({});
    renderNew();
    expect(screen.getByLabelText('Layout file')).toHaveAttribute('type', 'file');
    expect(screen.queryByLabelText('Seating capacity')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Seated' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
  });

  it('sends nothing without a layout file, and says so beside it', async () => {
    const api = stubApi({});
    renderNew();
    fillNameAndAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a layout file: every new venue starts with one.',
    );
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('sends nothing for a file that is not JSON', async () => {
    const api = stubApi({});
    renderNew();
    fillNameAndAddress();
    chooseLayoutFile(new File(['not json'], 'seats.json', { type: 'application/json' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'seats.json is not a layout file: it is not JSON.',
    );
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it("creates the venue with the file's seats, then imports the file", async () => {
    const api = stubApi({
      'POST /locations': json({ ...VENUE, seatingCapacity: 70 }, 201),
      [`POST ${IMPORT_PATH}`]: json({ id: 'l-imported' }, 201),
    });
    renderNew();

    fillNameAndAddress();
    chooseLayoutFile(layoutFile(70));
    fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));

    expect(await screen.findByText('Venue list', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /locations',
      `POST ${IMPORT_PATH}`,
    ]);
    expect(writes[0].body).toEqual({
      name: 'Seat Hall',
      ...SENT_ADDRESS,
      ...SENT_ZONE,
      seatingCapacity: 70,
    });
    expect(writes[1].body).toMatchObject({ file: { format: 1, name: 'Basketball' } });
  });

  it('says so, with a way to the venue, when the layout file is refused', async () => {
    const message = 'The layout file has 1 problem.';
    stubApi({
      'POST /locations': json(VENUE, 201),
      [`POST ${IMPORT_PATH}`]: json({ error: { code: 'LAYOUT_FILE_INVALID', message } }, 400),
    });
    renderNew();

    fillNameAndAddress();
    chooseLayoutFile();
    fireEvent.click(screen.getByRole('button', { name: 'Create venue' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent('The venue was created without its seating layout.');
    expect(within(alert).getByRole('link', { name: 'Add the layout on its page' })).toHaveAttribute(
      'href',
      `/locations/${VENUE.id}`,
    );
  });
});
