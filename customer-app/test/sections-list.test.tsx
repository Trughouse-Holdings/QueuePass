import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Order } from '@queuepass/shared';
import {
  availability,
  event,
  holdBackend,
  json,
  order,
  renderCustomer,
  seatedMap,
  stubApi,
  fixTimeBeforeFixtures,
  type MapLevelFixture,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 038 US4 (T041; FR-020, FR-021, SC-007): the Sections list beside the map. Each section with
 * the price range of its open seats and their count, under the map's price filter; a section
 * chosen lists its seats as buttons grouped by row; pressing one holds or releases it through
 * `033`'s queue exactly as a click on the map, and the map and the list always agree. The whole
 * way to buying works by keyboard alone.
 */
afterEach(() => vi.unstubAllGlobals());

const levels: MapLevelFixture[] = [
  { levelId: 'l-court', name: 'Courtside', rank: 1, color: 'violet', price: '95.00' },
  { levelId: 'l-side', name: 'Lower sideline', rank: 2, color: 'blue', price: '60.00' },
  { levelId: 'l-end', name: 'Lower end', rank: 3, color: 'teal', price: '35.00' },
  { levelId: 'l-up', name: 'Upper', rank: 4, color: 'green', price: null },
];

/** Section 115: rows F (Courtside) and P (Lower sideline), 8 seats each; 101; 301 off sale. */
const arena = seatedMap(
  [
    {
      sectionId: 's-115',
      name: '115',
      rows: 2,
      seatsPerRow: 8,
      rowLabels: ['F', 'P'],
      rowLevels: ['l-court', 'l-side'],
      sold: [[1, 8]],
    },
    { sectionId: 's-101', name: '101', rows: 1, seatsPerRow: 3, levelId: 'l-end' },
    {
      sectionId: 's-301',
      name: '301',
      rows: 1,
      seatsPerRow: 2,
      levelId: 'l-up',
      offSale: [
        [1, 1],
        [1, 2],
      ],
    },
  ],
  { levels, layoutName: 'Basketball' },
);

const seated = event({
  reservedSeating: true,
  layoutId: 'lay-1',
  basePrice: '35.00',
  priceMax: '95.00',
});

const holds = () =>
  holdBackend({
    sections: { 's-115': '115' },
    seatInfo: (p) => ({
      rowLabel: p.row === 1 ? 'F' : 'P',
      levelName: p.row === 1 ? 'Courtside' : 'Lower sideline',
      price: p.row === 1 ? '95.00' : '60.00',
    }),
  });

const routes = (extra: Record<string, unknown> = {}) => ({
  'GET /events/e1': json(seated),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 18 })),
  'GET /me/reservations': json([]),
  ...arena.routes,
  ...(extra as Record<string, Response>),
});

const list = () => screen.getByRole('region', { name: 'Sections' });
const drawing = () => screen.getByRole('group', { name: 'Basketball map' });
const listed = (name: string) =>
  within(list()).getByRole('button', { name: new RegExp(`^Section ${name}(,|$)`) });
const inList = (row: string, seat: number) =>
  within(list()).getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${seat}, `) });
const onMap = (row: string, seat: number) =>
  within(drawing()).getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${seat}, `) });
const posts = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]);

async function chooseSeats() {
  fireEvent.click(await screen.findByRole('button', { name: 'Choose seats' }));
  return screen.findByRole('region', { name: 'Sections' });
}

describe('the Sections list beside the map (FR-020)', () => {
  it('lists each section with its open seats’ price range and count, under the price filter', async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });
    await chooseSeats();
    expect(drawing()).toBeInTheDocument();
    expect(
      within(list())
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Section 115, $60–$95, 15 open seats',
      'Section 101, $35, 3 open seats',
      'Section 301, no open seats',
    ]);

    fireEvent.change(screen.getByRole('slider', { name: 'Lowest price' }), {
      target: { value: '70' },
    });
    expect(listed('115')).toHaveAccessibleName('Section 115, $95, 7 open seats');
    expect(listed('101')).toHaveAccessibleName('Section 101, no open seats between $70 and $95');
  });

  it('holds from the list through the same queue, and each view shows the other’s holds', async () => {
    const b = holds();
    const { calls } = stubApi(routes(b.routes));
    renderCustomer({ at: '/events/e1' });
    await chooseSeats();
    fireEvent.click(listed('115'));
    // One state: the map is in the same section.
    await within(list()).findByRole('group', { name: 'Row F' });
    expect(screen.getByRole('button', { name: 'Back to map' })).toBeInTheDocument();

    // A press in the list holds the seat, as a click on the map would.
    fireEvent.click(inList('P', 7));
    await waitFor(() => expect(onMap('P', 7)).toHaveAccessibleName(/held by you$/));
    expect(inList('P', 7)).toHaveAttribute('aria-pressed', 'true');
    // A click on the map shows in the list.
    fireEvent.click(onMap('F', 7));
    await waitFor(() =>
      expect(inList('F', 7)).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, held by you'),
    );
    expect(posts(calls)).toEqual([
      ['/events/e1/reservation', { seats: [{ sectionId: 's-115', row: 2, seat: 7 }] }],
      ['/events/e1/reservation', { seats: [{ sectionId: 's-115', row: 1, seat: 7 }] }],
    ]);
    expect(
      within(screen.getByRole('region', { name: 'Your seats' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Section 115, Row F, Seat 7, Courtside, $95.00',
      'Section 115, Row P, Seat 7, Lower sideline, $60.00',
    ]);

    // Released from the list, open on the map.
    fireEvent.click(inList('F', 7));
    await waitFor(() =>
      expect(onMap('F', 7)).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, open'),
    );
    expect(posts(calls).at(-1)).toEqual([
      '/events/e1/reservation/release',
      { seats: [{ sectionId: 's-115', row: 1, seat: 7 }] },
    ]);
    // A sold seat does nothing.
    fireEvent.click(inList('F', 8));
    expect(inList('F', 8)).toHaveAttribute('aria-disabled', 'true');
    expect(posts(calls)).toHaveLength(3);
  });

  it('takes the whole way to buying by keyboard alone (SC-007)', async () => {
    const user = userEvent.setup();
    const b = holds();
    const bought: Order = order({
      quantity: 1,
      unitPrice: '60.00',
      totalPrice: '60.00',
      tickets: [
        {
          id: 'k1',
          code: 'AAAA2222BBBB',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: '115', row: 2, seat: 7, rowLabel: 'P', seatLabel: '7' },
          price: '60.00',
          levelName: 'Lower sideline',
        },
      ],
    });
    const { calls } = stubApi(routes({ ...b.routes, 'POST /events/e1/orders': json(bought, 201) }));
    renderCustomer({ at: '/events/e1' });

    (await screen.findByRole('button', { name: 'Choose seats' })).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'Sections' });
    // The list is reached by Tab, past the map.
    const first = listed('115');
    for (let i = 0; i < 40 && document.activeElement !== first; i += 1) await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard('{Enter}');
    const seat = await within(list()).findByRole('button', {
      name: 'Row P, Seat 7, Lower sideline, $60, open',
    });
    seat.focus();
    await user.keyboard(' ');
    await waitFor(() =>
      expect(seat).toHaveAccessibleName('Row P, Seat 7, Lower sideline, $60, held by you'),
    );
    expect(seat).toHaveFocus();

    (await screen.findByRole('button', { name: 'Add to cart' })).focus();
    await user.keyboard('{Enter}');
    const name = await screen.findByRole('textbox', { name: 'Name on tickets' });
    name.focus();
    await user.keyboard('Sam Rivera');
    screen.getByRole('button', { name: 'Buy tickets' }).focus();
    await user.keyboard('{Enter}');

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    expect(within(done).getByText(/Section 115, Row P, Seat 7/)).toBeInTheDocument();
    expect(
      calls.find((c) => c.method === 'POST' && c.path === '/events/e1/orders')?.body,
    ).toMatchObject({ holderName: 'Sam Rivera', seats: [{ sectionId: 's-115', row: 2, seat: 7 }] });
  });
});
