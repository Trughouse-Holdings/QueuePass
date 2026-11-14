import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocationDetail } from '../src/pages/LocationDetail';
import { LocationForm } from '../src/pages/LocationForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 038 US1 (FR-004–FR-009; research R15): the venue page's Layouts card. Each layout's counts,
 * how many events use it, whether it is locked, and a preview; Import layout file, New layout from
 * section lines, Rename, Duplicate and Delete, each refusal beside its control; the venue's
 * capacity read-only, from its largest layout.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PATH = `/locations/${VENUE.id}`;
const LIST = `${PATH}/layouts`;
const IMPORT = `${PATH}/layouts/import`;

type Outline = [number, number][];
const box = (x: number, y: number): Outline => [
  [x, y],
  [x + 30, y],
  [x + 30, y + 20],
  [x, y + 20],
];

const summary = (over: Record<string, unknown>) => ({
  locationId: VENUE.id,
  source: 'FILE',
  floorKind: 'COURT',
  seatCount: 100,
  sectionCount: 1,
  levelCount: 1,
  eventsUsing: 0,
  locked: false,
  ...over,
});
const BASKETBALL = summary({
  id: 'l-bb',
  name: 'Basketball',
  seatCount: 22090,
  sectionCount: 54,
  levelCount: 4,
  eventsUsing: 2,
  locked: true,
});
const CLUB = summary({
  id: 'l-club',
  name: 'Club room',
  source: 'LINES',
  floorKind: 'NONE',
  seatCount: 400,
  sectionCount: 2,
  levelCount: 2,
});
const detail = (s: Record<string, unknown>, sections: number) => ({
  ...s,
  size: { width: 1000, height: 640 },
  floorOutline: s.floorKind === 'NONE' ? null : box(400, 300),
  levels: [
    { id: `${s.id}-front`, name: 'Front', rank: 1, color: 'violet', seatCount: 200 },
    { id: `${s.id}-back`, name: 'Back', rank: 2, color: 'teal', seatCount: 200 },
  ],
  sections: Array.from({ length: sections }, (_, i) => ({
    id: `${s.id}-s${i}`,
    name: i === 0 ? 'Floor A' : i === 1 ? 'Floor B' : String(100 + i),
    levelId: i === 1 ? `${s.id}-back` : `${s.id}-front`,
    outline: box(20 + (i % 9) * 100, 20 + Math.floor(i / 9) * 60),
    labelAt: [35 + (i % 9) * 100, 30 + Math.floor(i / 9) * 60],
    rowCount: 10,
    seatCount: 200,
    levelIds: [i === 1 ? `${s.id}-back` : `${s.id}-front`],
  })),
  latestPrices: null,
});
const SOLD_EVENT = {
  ...EVENT,
  name: 'Cardinals vs. Duke',
  layoutId: 'l-bb',
  reservedSeating: true,
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/locations/:id" element={<LocationDetail />} />
        <Route path="/locations/:id/edit" element={<LocationForm />} />
        <Route path="/locations" element={<p>Venues</p>} />
      </Routes>
    </MemoryRouter>,
  );

/** The page's routes, with the layout list served from `layouts` as it stands. */
function routes(
  layouts: Record<string, unknown>[],
  extra: Record<string, Response | (() => Response)> = {},
) {
  return {
    [`GET ${PATH}`]: json(VENUE),
    'GET /events': json([SOLD_EVENT]),
    [`GET ${LIST}`]: () => json(layouts),
    'GET /layouts/l-bb': json(detail(BASKETBALL, 54)),
    'GET /layouts/l-club': json(detail(CLUB, 2)),
    ...extra,
  };
}

const card = () => screen.findByRole('region', { name: 'Layouts' });
const item = async (name: string | RegExp) => within(await card()).findByRole('article', { name });

describe('Layouts card', () => {
  it("lists each layout's name, seats, sections, levels, events using it, a lock, and a preview", async () => {
    stubApi(routes([BASKETBALL, CLUB]));
    renderAt(PATH);

    const bb = await item('Basketball');
    expect(
      within(bb).getByText('22,090 seats · 54 sections · 4 price levels · used by 2 events'),
    ).toBeInTheDocument();
    // T013 as amended: the API names no event that locks it; a refused change names them (409).
    expect(within(bb).getByText('Locked: seats are sold or held')).toBeInTheDocument();
    expect(within(bb).queryByText(/Cardinals vs. Duke/)).toBeNull();
    const preview = await within(bb).findByRole('img', { name: 'Basketball: 54 sections' });
    expect(preview.querySelectorAll('.layout-preview__section')).toHaveLength(54);
    expect(preview.querySelectorAll('circle')).toHaveLength(0);

    const club = await item('Club room');
    expect(
      within(club).getByText('400 seats · 2 sections · 2 price levels · used by 0 events'),
    ).toBeInTheDocument();
    expect(within(club).queryByText(/Locked/)).toBeNull();
    expect(await within(club).findByRole('img', { name: 'Club room: 2 sections' })).toBeTruthy();
  });

  it('says so when the venue has no layouts', async () => {
    stubApi(routes([]));
    renderAt(PATH);
    expect(await within(await card()).findByText('No layouts yet.')).toBeInTheDocument();
  });

  it('imports a chosen layout file as it reads, then lists the new layout', async () => {
    let layouts: Record<string, unknown>[] = [];
    const file = { format: 1, name: 'Basketball', sections: [] };
    const api = stubApi(
      routes([], {
        [`GET ${LIST}`]: () => json(layouts),
        [`POST ${IMPORT}`]: () => {
          layouts = [BASKETBALL];
          return json(detail(BASKETBALL, 54), 201);
        },
      }),
    );
    renderAt(PATH);

    const region = await card();
    const input = within(region).getByLabelText('Layout file');
    fireEvent.change(input, {
      target: {
        files: [new File([JSON.stringify(file)], 'basketball.json', { type: 'application/json' })],
      },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Import layout file' }));

    expect(await item('Basketball')).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ file });
  });

  it('lists every problem of a refused file under the input and keeps the file chosen', async () => {
    const problems = [
      {
        path: 'file.sections[0].rows[0].seats[2]',
        message: 'Section 104, row F: seat 7 appears twice',
      },
      { path: 'file.sections[1].level', message: 'Section 104: level "upper" is not in the file' },
    ];
    stubApi(
      routes([], {
        [`POST ${IMPORT}`]: json(
          {
            error: {
              code: 'LAYOUT_FILE_INVALID',
              message: 'The layout file has 2 problems; nothing was saved.',
              details: { problems, more: 3 },
            },
          },
          400,
        ),
      }),
    );
    renderAt(PATH);

    const region = await card();
    const input = within(region).getByLabelText('Layout file') as HTMLInputElement;
    const chosen = new File(['{"format":1}'], 'bad.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [chosen] } });
    fireEvent.click(within(region).getByRole('button', { name: 'Import layout file' }));

    const alert = await within(region).findByRole('alert');
    expect(alert).toHaveTextContent('The layout file has 2 problems; nothing was saved.');
    const listed = within(alert)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(listed).toEqual([
      'Section 104, row F: seat 7 appears twice (file.sections[0].rows[0].seats[2])',
      'Section 104: level "upper" is not in the file (file.sections[1].level)',
      'and 3 more',
    ]);
    expect(input.files?.[0]).toBe(chosen);
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('says a file that is not JSON is not a layout file, sending nothing', async () => {
    const api = stubApi(routes([]));
    renderAt(PATH);
    const region = await card();
    fireEvent.change(within(region).getByLabelText('Layout file'), {
      target: { files: [new File(['not json'], 'notes.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Import layout file' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'notes.txt is not a layout file: it is not JSON.',
    );
    expect(api.count('POST', IMPORT)).toBe(0);
  });

  it('makes a layout from section lines, with level names and a level for each section', async () => {
    const api = stubApi(routes([], { [`POST ${LIST}`]: json(detail(CLUB, 2), 201) }));
    renderAt(PATH);

    const region = await card();
    fireEvent.click(within(region).getByRole('button', { name: 'New layout from section lines' }));
    fireEvent.change(within(region).getByLabelText('Layout name'), {
      target: { value: 'Club room' },
    });
    fireEvent.change(within(region).getByRole('textbox', { name: 'Level 1 Level name' }), {
      target: { value: 'Front' },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Add level' }));
    fireEvent.change(within(region).getByRole('textbox', { name: 'Level 2 Level name' }), {
      target: { value: 'Back' },
    });
    fireEvent.change(within(region).getByRole('combobox', { name: 'Level 2 Color' }), {
      target: { value: 'teal' },
    });
    for (const [n, name, level] of [
      [1, 'Floor A', 'Front'],
      [2, 'Floor B', 'Back'],
    ] as const) {
      fireEvent.click(within(region).getByRole('button', { name: 'Add section' }));
      fireEvent.change(within(region).getByRole('textbox', { name: `Section ${n} Section name` }), {
        target: { value: name },
      });
      fireEvent.change(within(region).getByRole('spinbutton', { name: `Section ${n} Rows` }), {
        target: { value: '10' },
      });
      fireEvent.change(
        within(region).getByRole('spinbutton', { name: `Section ${n} Seats per row` }),
        { target: { value: '20' } },
      );
      fireEvent.change(within(region).getByRole('combobox', { name: `Section ${n} Price level` }), {
        target: { value: level },
      });
    }
    fireEvent.click(within(region).getByRole('button', { name: 'Save layout' }));

    await waitFor(() => expect(api.count('POST', LIST)).toBe(1));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Club room',
      levels: [
        { name: 'Front', color: 'violet' },
        { name: 'Back', color: 'teal' },
      ],
      sections: [
        { name: 'Floor A', rows: 10, seatsPerRow: 20, level: 'Front' },
        { name: 'Floor B', rows: 10, seatsPerRow: 20, level: 'Back' },
      ],
    });
  });

  it('renames a layout, and shows a refusal beside Rename', async () => {
    let reply = json({ ...detail(CLUB, 2), name: 'Club room (VIP)' });
    const api = stubApi(routes([CLUB], { 'PUT /layouts/l-club': () => reply }));
    renderAt(PATH);

    const club = await item('Club room');
    fireEvent.click(within(club).getByRole('button', { name: 'Rename Club room' }));
    fireEvent.change(within(club).getByLabelText('New name for Club room'), {
      target: { value: 'Club room (VIP)' },
    });
    fireEvent.click(within(club).getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(api.count('PUT', '/layouts/l-club')).toBe(1));
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'Club room (VIP)' });

    reply = json(
      {
        error: {
          code: 'LAYOUT_NAME_TAKEN',
          message: 'Yum Center already has a layout named "Basketball".',
        },
      },
      409,
    );
    const again = await item(/Club room/);
    fireEvent.click(within(again).getByRole('button', { name: /^Rename / }));
    fireEvent.change(within(again).getByLabelText(/^New name for/), {
      target: { value: 'Basketball' },
    });
    fireEvent.click(within(again).getByRole('button', { name: 'Save name' }));
    const alert = await within(again).findByRole('alert');
    expect(alert).toHaveTextContent('Yum Center already has a layout named "Basketball".');
    // The name typed stays, to correct.
    expect(within(again).getByLabelText(/^New name for/)).toHaveValue('Basketball');
  });

  it('duplicates a layout, locked or not', async () => {
    let layouts = [BASKETBALL];
    const copy = summary({
      ...BASKETBALL,
      id: 'l-copy',
      name: 'Basketball (copy)',
      locked: false,
      eventsUsing: 0,
    });
    const api = stubApi(
      routes(layouts, {
        [`GET ${LIST}`]: () => json(layouts),
        'POST /layouts/l-bb/duplicate': () => {
          layouts = [BASKETBALL, copy];
          return json(detail(copy, 54), 201);
        },
        'GET /layouts/l-copy': json(detail(copy, 54)),
      }),
    );
    renderAt(PATH);

    fireEvent.click(
      within(await item('Basketball')).getByRole('button', { name: 'Duplicate Basketball' }),
    );
    expect(await item('Basketball (copy)')).toBeInTheDocument();
    expect(api.count('POST', '/layouts/l-bb/duplicate')).toBe(1);
  });

  it('deletes a layout only after confirming, and shows a refusal beside Delete', async () => {
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const message =
      'Basketball is used by "Cardinals vs. Duke", which has sold or held seats. Duplicate it to make changes.';
    const api = stubApi(
      routes([BASKETBALL], {
        'DELETE /layouts/l-bb': json({ error: { code: 'LAYOUT_IN_USE', message } }, 409),
      }),
    );
    renderAt(PATH);

    const bb = await item('Basketball');
    const remove = within(bb).getByRole('button', { name: 'Delete Basketball' });
    fireEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Basketball'));
    expect(api.count('DELETE', '/layouts/l-bb')).toBe(0);

    fireEvent.click(remove);
    const alert = await within(bb).findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(api.count('DELETE', '/layouts/l-bb')).toBe(1);
  });

  it('removes a deleted layout from the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let layouts = [BASKETBALL, CLUB];
    stubApi(
      routes(layouts, {
        [`GET ${LIST}`]: () => json(layouts),
        'DELETE /layouts/l-club': () => {
          layouts = [BASKETBALL];
          return json(null, 204);
        },
      }),
    );
    renderAt(PATH);
    fireEvent.click(
      within(await item('Club room')).getByRole('button', { name: 'Delete Club room' }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Layouts' })).queryByRole('article', {
          name: 'Club room',
        }),
      ).toBeNull(),
    );
  });
});

describe("the venue's capacity (FR-009)", () => {
  it('reads "From the largest layout" on the venue page', async () => {
    stubApi(routes([BASKETBALL, CLUB]));
    renderAt(PATH);
    expect(await screen.findByText('From the largest layout (22,090 seats)')).toBeInTheDocument();
  });

  it('is a read-only field on Edit while the venue has layouts, and never sent', async () => {
    const api = stubApi({
      [`GET ${PATH}`]: json(VENUE),
      [`GET ${LIST}`]: json([BASKETBALL, CLUB]),
      [`PATCH ${PATH}`]: json(VENUE),
      'GET /locations': json([VENUE]),
      'GET /events': json([]),
    });
    renderAt(`${PATH}/edit`);

    const field = await screen.findByLabelText('Seating capacity');
    await waitFor(() => expect(field).toHaveAttribute('readonly'));
    expect(field).toHaveValue(22090);
    expect(screen.getByText('From the largest layout (22,090 seats)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.count('PATCH', PATH)).toBe(1));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).not.toHaveProperty('seatingCapacity');
  });

  it('stays a typed field for a venue without layouts', async () => {
    stubApi({ [`GET ${PATH}`]: json(VENUE), [`GET ${LIST}`]: json([]) });
    renderAt(`${PATH}/edit`);
    const field = await screen.findByLabelText('Seating capacity');
    expect(field).toHaveValue(22090);
    expect(field).not.toHaveAttribute('readonly');
  });
});
