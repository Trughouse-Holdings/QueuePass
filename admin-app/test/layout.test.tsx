import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocationDetail } from '../src/pages/LocationDetail';
import { json, stubApi } from './helpers/api-stub';
import { VENUE } from './fixtures-005';

/** Spec 007 US1 (FR-001, FR-003): the venue page's seating layout. */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PATH = `/locations/${VENUE.id}`;
const LAYOUT_PATH = `${PATH}/layout`;
const A = { id: 's-a', name: 'A', rows: 3, seatsPerRow: 10 };
const B = { id: 's-b', name: 'B', rows: 2, seatsPerRow: 20 };
const layout = (sections: object[], totalSeats: number) => ({
  locationId: VENUE.id,
  totalSeats,
  sections,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/locations/:id" element={<LocationDetail />} />
      </Routes>
    </MemoryRouter>,
  );

const routes = (extra: Record<string, Response | (() => Response)> = {}) => ({
  [`GET ${PATH}`]: json(VENUE),
  'GET /events': json([]),
  [`GET ${LAYOUT_PATH}`]: json(layout([A, B], 70)),
  ...extra,
});

const card = () => screen.findByRole('region', { name: 'Seating layout' });

describe('Seating layout card', () => {
  it('lists each section with its size and seats, and the total', async () => {
    stubApi(routes());
    renderPage();

    const region = await card();
    const rows = await within(region).findAllByRole('row');
    expect(rows.slice(1).map((r) => r.textContent)).toEqual([
      'A3 rows × 10 seats30',
      'B2 rows × 20 seats40',
    ]);
    expect(within(region).getByText('Total: 70 seats')).toBeInTheDocument();
  });

  it('says so when the venue has no layout', async () => {
    stubApi(routes({ [`GET ${LAYOUT_PATH}`]: json(layout([], 0)) }));
    renderPage();

    expect(await within(await card()).findByText('No seating layout')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove layout' })).toBeNull();
  });

  it('edits the layout and saves the sections in order', async () => {
    const saved = layout([A, B, { id: 's-c', name: 'C', rows: 1, seatsPerRow: 5 }], 75);
    const api = stubApi(routes({ [`PUT ${LAYOUT_PATH}`]: json(saved) }));
    renderPage();

    fireEvent.click(await within(await card()).findByRole('button', { name: 'Edit layout' }));
    expect(screen.getByRole('textbox', { name: 'Section 1 name' })).toHaveValue('A');
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 3 name' }), {
      target: { value: 'C' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Section 3 rows' }), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Section 3 seats per row' }), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    expect(await within(await card()).findByText('Total: 75 seats')).toBeInTheDocument();
    const put = api.calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({
      sections: [
        { name: 'A', rows: 3, seatsPerRow: 10 },
        { name: 'B', rows: 2, seatsPerRow: 20 },
        { name: 'C', rows: 1, seatsPerRow: 5 },
      ],
    });
  });

  it('removes a section line before saving', async () => {
    const api = stubApi(routes({ [`PUT ${LAYOUT_PATH}`]: json(layout([B], 40)) }));
    renderPage();

    fireEvent.click(await within(await card()).findByRole('button', { name: 'Edit layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove section 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    await within(await card()).findByText('Total: 40 seats');
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      sections: [{ name: 'B', rows: 2, seatsPerRow: 20 }],
    });
  });

  it.each([
    [
      'LAYOUT_IN_USE',
      'The seating layout of Yum Center is in use by "Season Opener", which has sold seats.',
    ],
    [
      'CAPACITY_EXCEEDED',
      'The layout has 70 seats, fewer than "Big Night" sells (100 tickets). Lower its capacity first.',
    ],
  ])("shows a %s refusal in the Backend's words", async (code, message) => {
    stubApi(routes({ [`PUT ${LAYOUT_PATH}`]: json({ error: { code, message } }, 409) }));
    renderPage();

    fireEvent.click(await within(await card()).findByRole('button', { name: 'Edit layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('removes the layout only after confirming', async () => {
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const api = stubApi(routes({ [`DELETE ${LAYOUT_PATH}`]: json(null, 204) }));
    renderPage();

    const remove = await within(await card()).findByRole('button', { name: 'Remove layout' });
    fireEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Yum Center'));
    expect(api.count('DELETE', LAYOUT_PATH)).toBe(0);

    fireEvent.click(remove);
    expect(await within(await card()).findByText('No seating layout')).toBeInTheDocument();
    expect(api.count('DELETE', LAYOUT_PATH)).toBe(1);
  });
});
