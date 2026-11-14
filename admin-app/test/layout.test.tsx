import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocationDetail } from '../src/pages/LocationDetail';
import { json, stubApi } from './helpers/api-stub';
import { VENUE } from './fixtures-005';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 007 US1 as spec 038 amends it (FR-005, FR-006; research R6, R15): a layout made from section
 * lines is edited as lines again, each with its price level, on the venue page's Layouts card.
 * An imported layout has no lines to edit.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PATH = `/locations/${VENUE.id}`;
const LINES_ID = 'l-club';
const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const CLUB = {
  id: LINES_ID,
  locationId: VENUE.id,
  name: 'Club room',
  source: 'LINES',
  floorKind: 'NONE',
  seatCount: 70,
  sectionCount: 2,
  levelCount: 2,
  eventsUsing: 0,
  locked: false,
  size: { width: 100, height: 40 },
  floorOutline: null,
  levels: [
    { id: 'lv-front', name: 'Front', rank: 1, color: 'violet', seatCount: 30 },
    { id: 'lv-back', name: 'Back', rank: 2, color: 'teal', seatCount: 40 },
  ],
  sections: [
    {
      id: 's-a',
      name: 'A',
      levelId: 'lv-front',
      outline: square,
      labelAt: [5, 5],
      rowCount: 3,
      seatCount: 30,
      levelIds: ['lv-front'],
    },
    {
      id: 's-b',
      name: 'B',
      levelId: 'lv-back',
      outline: square,
      labelAt: [5, 5],
      rowCount: 2,
      seatCount: 40,
      levelIds: ['lv-back'],
    },
  ],
  latestPrices: null,
};
const FILE_LAYOUT = { ...CLUB, id: 'l-file', name: 'Basketball', source: 'FILE' };
const { size: _s, floorOutline: _f, levels: _l, sections: _x, latestPrices: _p, ...SUMMARY } = CLUB;

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
  [`GET ${PATH}/layouts`]: json([SUMMARY]),
  [`GET /layouts/${LINES_ID}`]: json(CLUB),
  ...extra,
});

const club = () => screen.findByRole('article', { name: 'Club room' });
const edit = async () =>
  fireEvent.click(
    within(await club()).getByRole('button', { name: 'Edit section lines of Club room' }),
  );

describe('Editing a layout made from section lines', () => {
  it('starts from its lines, each with its rows, seats per row and price level', async () => {
    stubApi(routes());
    renderPage();
    await edit();

    expect(screen.getByRole('textbox', { name: 'Section 1 Section name' })).toHaveValue('A');
    expect(screen.getByRole('spinbutton', { name: 'Section 1 Rows' })).toHaveValue(3);
    expect(screen.getByRole('spinbutton', { name: 'Section 1 Seats per row' })).toHaveValue(10);
    expect(screen.getByRole('combobox', { name: 'Section 2 Price level' })).toHaveValue('Back');
    expect(screen.getByRole('textbox', { name: 'Level 2 Level name' })).toHaveValue('Back');
    expect(screen.getByRole('combobox', { name: 'Level 1 Color' })).toHaveValue('violet');
    expect(screen.getByText('Total: 70 seats')).toBeInTheDocument();
  });

  it('saves the levels and the lines in order', async () => {
    const api = stubApi(routes({ [`PUT /layouts/${LINES_ID}`]: json(CLUB) }));
    renderPage();
    await edit();

    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 3 Section name' }), {
      target: { value: 'C' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Section 3 Seats per row' }), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Section 3 Price level' }), {
      target: { value: 'Back' },
    });
    expect(
      within(screen.getByRole('group', { name: 'Section 2' })).getByText('= 40 seats'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    await waitFor(() => expect(api.count('PUT', `/layouts/${LINES_ID}`)).toBe(1));
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      name: 'Club room',
      levels: [
        { name: 'Front', color: 'violet' },
        { name: 'Back', color: 'teal' },
      ],
      sections: [
        { name: 'A', rows: 3, seatsPerRow: 10, level: 'Front' },
        { name: 'B', rows: 2, seatsPerRow: 20, level: 'Back' },
        { name: 'C', rows: 1, seatsPerRow: 5, level: 'Back' },
      ],
    });
  });

  it('removes a section line before saving', async () => {
    const api = stubApi(routes({ [`PUT /layouts/${LINES_ID}`]: json(CLUB) }));
    renderPage();
    await edit();
    fireEvent.click(screen.getByRole('button', { name: 'Remove section 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(api.count('PUT', `/layouts/${LINES_ID}`)).toBe(1));
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      sections: [{ name: 'B', rows: 2, seatsPerRow: 20, level: 'Back' }],
    });
  });

  it.each([
    [
      'LAYOUT_IN_USE',
      'Club room is used by "Season Opener", which has sold or held seats. Duplicate it to make changes.',
    ],
    [
      'CAPACITY_EXCEEDED',
      'The layout has 70 seats, fewer than "Big Night" sells (100 tickets). Lower its capacity first.',
    ],
  ])("shows a %s refusal in the Backend's words, keeping the lines", async (code, message) => {
    stubApi(routes({ [`PUT /layouts/${LINES_ID}`]: json({ error: { code, message } }, 409) }));
    renderPage();
    await edit();
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    expect(await within(await club()).findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('textbox', { name: 'Section 1 Section name' })).toHaveValue('A');
  });

  it('offers no line edit for an imported layout', async () => {
    const {
      size: _a,
      floorOutline: _b,
      levels: _c,
      sections: _d,
      latestPrices: _e,
      ...summary
    } = FILE_LAYOUT;
    stubApi(
      routes({
        [`GET ${PATH}/layouts`]: json([summary]),
        'GET /layouts/l-file': json(FILE_LAYOUT),
      }),
    );
    renderPage();
    const item = await screen.findByRole('article', { name: 'Basketball' });
    expect(within(item).getByRole('button', { name: 'Rename Basketball' })).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: /Edit section lines/ })).toBeNull();
  });
});
