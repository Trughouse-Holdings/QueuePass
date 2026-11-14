import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { MyOrder, Order } from '@queuepass/shared';
import {
  availability,
  event,
  holdBackend,
  json,
  myOrder,
  order,
  renderCustomer,
  seatOf,
  seatStream,
  seatedMap,
  stubApi,
  typeHolderName,
  fixTimeBeforeFixtures,
  type MapLevelFixture,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 038 US3 (T033; FR-021, FR-022, FR-024; research R14): a customer chooses seats on the venue
 * map. A seated event shows its price range and Choose seats; the map opens in place; a section
 * zoomed into shows its seats; each click holds one seat (`033`'s queue); Your seats lists each
 * seat with its level and price, and the sum; the cart lists them from `listMyReservations`; the
 * tickets name each seat by its labels.
 */
afterEach(() => vi.unstubAllGlobals());

const levels: MapLevelFixture[] = [
  { levelId: 'l-court', name: 'Courtside', rank: 1, color: 'violet', price: '95.00' },
  { levelId: 'l-side', name: 'Lower sideline', rank: 2, color: 'blue', price: '60.00' },
  { levelId: 'l-end', name: 'Lower end', rank: 3, color: 'teal', price: '35.00' },
  { levelId: 'l-up', name: 'Upper', rank: 4, color: 'green', price: null },
];

/** Section 115: rows F (Courtside) and P (Lower sideline), seats 7 and 8; 101; 301 off sale. */
const arena = (over: { sold101?: boolean } = {}) =>
  seatedMap(
    [
      {
        sectionId: 's-115',
        name: '115',
        rows: 2,
        seatsPerRow: 8,
        rowLabels: ['F', 'P'],
        rowLevels: ['l-court', 'l-side'],
      },
      {
        sectionId: 's-101',
        name: '101',
        rows: 1,
        seatsPerRow: 1,
        levelId: 'l-end',
        ...(over.sold101 ? { sold: [[1, 1] as [number, number]] } : {}),
      },
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

/** The hold backend, with each seat's labels, level and price as section 115 has them. */
const holds = (prices: { side: string } = { side: '60.00' }) =>
  holdBackend({
    sections: { 's-115': '115' },
    seatInfo: (p) => ({
      rowLabel: p.row === 1 ? 'F' : 'P',
      levelName: p.row === 1 ? 'Courtside' : 'Lower sideline',
      price: p.row === 1 ? '95.00' : prices.side,
    }),
  });

const routes = (extra: Record<string, unknown> = {}) => ({
  'GET /events/e1': json(seated),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 18 })),
  'GET /me/reservations': json([]),
  ...arena().routes,
  ...(extra as Record<string, Response>),
});

const yourSeats = () => screen.getByRole('region', { name: 'Your seats' });
const items = (el: HTMLElement) =>
  within(el)
    .getAllByRole('listitem')
    .map((li) => li.textContent);

const hold = async (row: string, seat: number) => {
  fireEvent.click(seatOf(row, seat));
  await waitFor(() => expect(seatOf(row, seat)).toHaveAccessibleName(/held by you$/));
};

describe('a seated event (FR-024)', () => {
  it('shows its price range and Choose seats, with no ticket-type step', async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });
    expect(await screen.findByText('$35–$95')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Choose seats' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Ticket type' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Quantity' })).toBeNull();
    // The map opens only when asked.
    expect(screen.queryByRole('group', { name: 'Basketball map' })).toBeNull();
  });

  it('shows the range on the events list too', async () => {
    stubApi({ 'GET /events': json([seated]), 'GET /locations': json([]) });
    renderCustomer({ at: '/events' });
    expect(await screen.findByText('$35–$95')).toBeInTheDocument();
  });
});

describe('choosing seats on the map (FR-021, FR-022; research R14)', () => {
  it('opens the map, zooms into a section, and holds seats of two levels one click each', async () => {
    const b = holds();
    const { calls } = stubApi(routes(b.routes));
    renderCustomer({ at: '/events/e1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose seats' }));

    const map = await screen.findByRole('group', { name: 'Basketball map' });
    // The legend names each level with its price.
    expect(items(screen.getByRole('list', { name: 'Price levels' }))).toEqual([
      'Courtside $95',
      'Lower sideline $60',
      'Lower end $35',
      'Upper: not on sale',
    ]);
    fireEvent.click(within(map).getByRole('button', { name: /^Section 115,/ }));
    await screen.findByRole('button', { name: 'Row F, Seat 7, Courtside, $95, open' });

    await hold('F', 7);
    await hold('P', 7);

    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { seats: [{ sectionId: 's-115', row: 1, seat: 7 }] },
      { seats: [{ sectionId: 's-115', row: 2, seat: 7 }] },
    ]);
    // One countdown; each seat with its own level and price; the sum.
    expect(within(yourSeats()).getAllByRole('timer')).toHaveLength(1);
    expect(items(yourSeats())).toEqual([
      'Section 115, Row F, Seat 7, Courtside, $95.00',
      'Section 115, Row P, Seat 7, Lower sideline, $60.00',
    ]);
    expect(within(yourSeats()).getByText('Total: $155.00')).toBeInTheDocument();
    expect(document.querySelector('[data-announces="holds"]')).toHaveTextContent(
      'Section 115, Row P, Seat 7 held.',
    );

    // A click on a held seat releases it.
    fireEvent.click(seatOf('F', 7));
    await waitFor(() =>
      expect(seatOf('F', 7)).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, open'),
    );
    expect(items(yourSeats())).toEqual(['Section 115, Row P, Seat 7, Lower sideline, $60.00']);

    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(screen.queryByRole('button', { name: /^Row / })).toBeNull();
    // Your seats stays below the map.
    expect(yourSeats()).toBeInTheDocument();
  });

  it('opens the map at once when the customer already holds seats of the event', async () => {
    const b = holds();
    stubApi(routes(b.routes));
    // A hold made earlier (from the cart's Change seats).
    await b.routes['POST /events/e1/reservation'](
      new Request('http://x/', {
        method: 'POST',
        body: JSON.stringify({ seats: [{ sectionId: 's-115', row: 2, seat: 8 }] }),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    expect(await screen.findByRole('group', { name: 'Basketball map' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose seats' })).toBeNull();
    expect(await screen.findByRole('region', { name: 'Your seats' })).toBeInTheDocument();
  });
});

describe('the cart and buying (FR-022; research R14, review M4)', () => {
  it('lists each seat with its level and price from listMyReservations, and a changed price', async () => {
    const prices = { side: '60.00' };
    const b = holds(prices);
    const { calls } = stubApi(routes(b.routes));
    renderCustomer({ at: '/events/e1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose seats' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Section 115,/ }));
    await screen.findByRole('button', { name: /^Row F, Seat 7,/ });
    await hold('F', 7);
    await hold('P', 7);
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

    const seats = await screen.findByRole('list', { name: 'Seats' });
    expect(items(seats)).toEqual([
      'Section 115, Row F, Seat 7, Courtside, $95.00',
      'Section 115, Row P, Seat 7, Lower sideline, $60.00',
    ]);
    expect(screen.getByText('Total: $155.00')).toBeInTheDocument();
    const mapReads = calls.filter((c) => c.path.startsWith('/events/e1/venue-map')).length;

    // An admin changes Lower sideline's price; the cart's next read shows it.
    prices.side = '65.00';
    await waitFor(() => expect(screen.getByText('Total: $160.00')).toBeInTheDocument(), {
      timeout: 2_500,
    });
    expect(items(screen.getByRole('list', { name: 'Seats' }))[1]).toBe(
      'Section 115, Row P, Seat 7, Lower sideline, $65.00',
    );
    // The cart reads no venue map.
    expect(calls.filter((c) => c.path.startsWith('/events/e1/venue-map')).length).toBe(mapReads);
  });

  it('buys them; the confirmation and My tickets name each seat by its labels', async () => {
    const b = holds();
    const bought: Order = order({
      quantity: 2,
      unitPrice: null,
      totalPrice: '155.00',
      tickets: [
        {
          id: 'k1',
          code: 'AAAA2222BBBB',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: '115', row: 1, seat: 7, rowLabel: 'F', seatLabel: '7' },
          price: '95.00',
          levelName: 'Courtside',
        },
        {
          id: 'k2',
          code: 'CCCC3333DDDD',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: '115', row: 2, seat: 7, rowLabel: 'P', seatLabel: '7' },
          price: '60.00',
          levelName: 'Lower sideline',
        },
      ],
    });
    const mine: MyOrder = { ...myOrder(), ...bought, event: myOrder().event };
    const { calls } = stubApi(
      routes({
        ...b.routes,
        'POST /events/e1/orders': json(bought, 201),
        'GET /me/orders': json([mine]),
      }),
    );
    renderCustomer({ at: '/events/e1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose seats' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Section 115,/ }));
    await screen.findByRole('button', { name: /^Row F, Seat 7,/ });
    await hold('F', 7);
    await hold('P', 7);
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    await screen.findByRole('list', { name: 'Seats' });
    await typeHolderName();
    fireEvent.click(screen.getByRole('button', { name: 'Buy tickets' }));

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    const body = calls.find((c) => c.method === 'POST' && c.path === '/events/e1/orders')?.body;
    expect(body).toMatchObject({
      quantity: 2,
      seats: [
        { sectionId: 's-115', row: 1, seat: 7 },
        { sectionId: 's-115', row: 2, seat: 7 },
      ],
    });
    expect(body).not.toHaveProperty('tierId');
    expect(items(within(done).getByRole('list', { name: 'Ticket codes' }))).toEqual([
      'AAAA2222BBBB, Section 115, Row F, Seat 7, Courtside, $95.00',
      'CCCC3333DDDD, Section 115, Row P, Seat 7, Lower sideline, $60.00',
    ]);
    // Prices differ: no single price each.
    expect(within(done).queryByText('Price each')).toBeNull();
    expect(within(done).getByText('$155.00')).toBeInTheDocument();

    fireEvent.click(within(done).getByRole('link', { name: 'See all my tickets' }));
    const tickets = await screen.findByRole('list', { name: 'Tickets' });
    expect(tickets).toHaveTextContent('Section 115, Row F, Seat 7');
    expect(tickets).toHaveTextContent('Section 115, Row P, Seat 7');
  });
});

describe('live changes (FR-023)', () => {
  it('recolors a section when its last open seat is held by someone else', async () => {
    const stream = seatStream();
    stubApi(routes({ 'GET /events/e1/seats/stream': () => stream.reply() }));
    renderCustomer({ at: '/events/e1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose seats' }));
    const s101 = await screen.findByRole('button', { name: /^Section 101,/ });
    expect(s101).toHaveClass('venue-map--teal');

    await waitFor(() => stream.send('venueMap', arena().map));
    act(() =>
      stream.send('seats', {
        eventId: 'e1',
        seq: 2,
        changes: [
          {
            sectionId: 's-101',
            row: 1,
            seat: 1,
            state: 'reserved',
            from: 'open',
            levelId: 'l-end',
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Section 101,/ })).toHaveClass(
        'venue-map--unavailable',
      ),
    );
    expect(screen.getByRole('button', { name: /^Section 101,/ })).toHaveAccessibleName(
      'Section 101, no open seats',
    );
  });
});
