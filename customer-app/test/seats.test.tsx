import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  availability,
  event,
  holdBackend,
  json,
  openSection,
  order,
  renderCustomer,
  seatOf,
  seatedMap,
  stubApi,
  typeHolderName,
  fixTimeBeforeFixtures,
  type MapLevelFixture,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 007 US2 (FR-007, FR-008, FR-011): choosing seats in the Get tickets form; since spec 033
 * each click holds the seat at once, and the seats are bought from the cart. Spec 038 (FR-016 to
 * FR-022; research R14): the seats are chosen on the venue map, a section at a time, each seat
 * at its own level's price.
 */
afterEach(() => vi.unstubAllGlobals());

const levels: MapLevelFixture[] = [
  { levelId: 'l-vip', name: 'VIP', rank: 1, color: 'violet', price: '120.00' },
  { levelId: 'l-gen', name: 'General', rank: 2, color: 'blue', price: '40.00' },
];
const SECTIONS = { 's-a': 'A', 's-c': 'C', 's-b': 'B' };
/** A (2 × 3, Row 1 Seat 2 sold) and C (1 × 2) are VIP; B (1 × 4) General. */
const arena = () =>
  seatedMap(
    [
      { sectionId: 's-a', name: 'A', rows: 2, seatsPerRow: 3, levelId: 'l-vip', sold: [[1, 2]] },
      { sectionId: 's-c', name: 'C', rows: 1, seatsPerRow: 2, levelId: 'l-vip' },
      { sectionId: 's-b', name: 'B', rows: 1, seatsPerRow: 4, levelId: 'l-gen' },
    ],
    { levels },
  );

type Reply = Response | ((req: Request) => Response | Promise<Response>);
const routes = (orderReply?: Reply, left = 56, extra: Record<string, Reply> = {}) => ({
  'GET /events/e1': json(
    event({ reservedSeating: true, layoutId: 'lay-1', basePrice: '40.00', priceMax: '120.00' }),
  ),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: left })),
  'GET /me/reservations': json([]),
  ...arena().routes,
  ...(orderReply ? { 'POST /events/e1/orders': orderReply } : {}),
  ...extra,
});
/** Spec 033: seat clicks answered by a hold backend, each seat with its level and price. */
const backend = () =>
  holdBackend({
    sections: SECTIONS,
    seatInfo: (p) =>
      p.sectionId === 's-b'
        ? { levelName: 'General', price: '40.00' }
        : { levelName: 'VIP', price: '120.00' },
  });
const withHolds = (r: Record<string, Reply> = routes()) => {
  const b = backend();
  return stubApi({
    ...r,
    ...b.routes,
    ...Object.fromEntries(Object.entries(r).filter(([k]) => k === 'POST /events/e1/reservation')),
  });
};
/** Clicks a seat and waits for it to be held. */
const hold = async (row: number, seat: number) => {
  fireEvent.click(seatOf(row, seat));
  await waitFor(() => expect(seatOf(row, seat)).toHaveAccessibleName(/, held by you$/));
};
/** Zooms into another section from the map. */
const goTo = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Section ${name},`) }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /^Row / })[0]).toHaveAccessibleName(
      name === 'B' ? /General/ : /VIP/,
    ),
  );
};
const drawing = () => screen.getByRole('group', { name: 'Arena map' });
const chosen = () => {
  const box = screen.queryByRole('region', { name: 'Your seats' });
  return box
    ? within(box)
        .queryAllByRole('listitem')
        .map((li) => li.textContent)
    : [];
};

describe('choosing seats (US2-1, US2-2; FR-007; spec 038 FR-018)', () => {
  it("offers every section on the map, then the chosen section's seats", async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('button', { name: 'Choose seats' }));
    const sections = within(await screen.findByRole('group', { name: 'Arena map' }))
      .getAllByRole('button', { name: /^Section / })
      .map((b) => b.getAttribute('aria-label')?.split(',')[0]);
    expect(sections).toEqual(['Section A', 'Section C', 'Section B']);

    await openSection('A');
    expect(seatOf(1, 1)).toHaveAttribute('aria-pressed', 'false');
    expect(seatOf(1, 2)).toHaveAccessibleName('Row 1, Seat 2, VIP, $120, sold');
    expect(seatOf(1, 2)).toHaveAttribute('aria-disabled', 'true');
    expect(within(drawing()).getAllByRole('button', { name: /^Row / })).toHaveLength(6);
  });

  it('lists held seats, keeps them across sections, and totals them', async () => {
    withHolds();
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    await hold(1, 1);
    await hold(2, 3);
    expect(seatOf(1, 1)).toHaveAttribute('aria-pressed', 'true');

    await goTo('C');
    await hold(1, 2);

    expect(chosen()).toEqual([
      'Section A, Row 1, Seat 1, VIP, $120.00',
      'Section A, Row 2, Seat 3, VIP, $120.00',
      'Section C, Row 1, Seat 2, VIP, $120.00',
    ]);
    expect(screen.getByText('Total: $360.00')).toBeInTheDocument();

    // Spec 033 FR-001: a click on a held seat releases it; there is no Remove.
    await goTo('A');
    fireEvent.click(seatOf(2, 3));
    await waitFor(() => expect(chosen()).toHaveLength(2));
    expect(screen.getByText('Total: $240.00')).toBeInTheDocument();
  });

  // Spec 038 FR-021: one hold may hold seats of any levels (it replaces 033's one ticket type).
  it('holds seats of two levels in one reservation, each at its own price', async () => {
    const { calls } = withHolds();
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    await hold(1, 1);
    await goTo('B');
    await hold(1, 4);

    expect(chosen()).toEqual([
      'Section A, Row 1, Seat 1, VIP, $120.00',
      'Section B, Row 1, Seat 4, General, $40.00',
    ]);
    expect(screen.getByText('Total: $160.00')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { seats: [{ sectionId: 's-a', row: 1, seat: 1 }] },
      { seats: [{ sectionId: 's-b', row: 1, seat: 4 }] },
    ]);
  });

  it('allows no more seats than the tickets left (and never more than 10)', async () => {
    withHolds(routes(undefined, 2));
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    await hold(1, 1);
    await hold(1, 3);

    expect(seatOf(2, 1)).toHaveAttribute('aria-disabled', 'true');
    expect(seatOf(1, 1)).not.toHaveAttribute('aria-disabled');
  });
});

describe('seat states beyond color (spec 008 US3; FR-008; spec 038 FR-019)', () => {
  it('marks held seats with a check, sold seats with a cross, and keeps their names', async () => {
    withHolds();
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    await hold(1, 1);

    expect(seatOf(1, 1)).toHaveAttribute('aria-pressed', 'true');
    expect(seatOf(1, 1).querySelector('.venue-map__mark--check')).not.toBeNull();
    expect(seatOf(1, 2)).toHaveAttribute('aria-disabled', 'true');
    expect(seatOf(1, 2).querySelector('.venue-map__mark--cross')).not.toBeNull();
    expect(seatOf(1, 3)).toHaveAccessibleName('Row 1, Seat 3, VIP, $120, open');
    expect(seatOf(1, 3).querySelector('.venue-map__mark')).toBeNull();
    expect(seatOf(1, 3)).toHaveAttribute('aria-pressed', 'false');
  });

  // Spec 038 FR-029: replaces 007's scrollable seat region; the map draws one section's seats.
  it("draws only the chosen section's seats on the map", async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    const seats = within(drawing()).getAllByRole('button', { name: /^Row / });
    expect(seats).toHaveLength(6);
    for (const s of seats) expect(s).toHaveAccessibleName(/, VIP, \$120, /);
  });
});

describe('a level with no seats on sale (spec 038 FR-016)', () => {
  // Spec 038 replaces 007's tier with no section: a level with nothing on sale has no price.
  it('says the level is not on sale, and its seats are off sale', async () => {
    const map = seatedMap(
      [
        { sectionId: 's-a', name: 'A', rows: 1, seatsPerRow: 2, levelId: 'l-vip' },
        {
          sectionId: 's-u',
          name: 'U',
          rows: 1,
          seatsPerRow: 2,
          levelId: 'l-up',
          offSale: [
            [1, 1],
            [1, 2],
          ],
        },
      ],
      {
        levels: [
          levels[0],
          { levelId: 'l-up', name: 'Upper', rank: 2, color: 'green', price: null },
        ],
      },
    );
    stubApi({ ...routes(), ...map.routes });
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('button', { name: 'Choose seats' }));
    expect(await screen.findByText('Upper: not on sale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Section U,/ })).toHaveAccessibleName(
      'Section U, no open seats',
    );
    await openSection('U');
    expect(seatOf(1, 1)).toHaveAccessibleName('Row 1, Seat 1, Upper, not on sale, off sale');
    expect(seatOf(1, 1)).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows a seated event with no tickets left as sold out, with no map', async () => {
    stubApi(routes(undefined, 0));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('Sold out: no tickets are left for this event.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose seats' })).toBeNull();
  });
});

describe('confirming seats (US2-3; FR-008, FR-011)', () => {
  it('sends the seats and their count, then lists each code with its seat', async () => {
    const placed = order({
      quantity: 2,
      unitPrice: '120.00',
      totalPrice: '240.00',
      tickets: [
        {
          id: 'k1',
          code: 'AAAA2222BBBB',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: 'A', row: 1, seat: 1, rowLabel: '1', seatLabel: '1' },
          price: '120.00',
          levelName: 'VIP',
        },
        {
          id: 'k2',
          code: 'CCCC3333DDDD',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: 'A', row: 1, seat: 3, rowLabel: '1', seatLabel: '3' },
          price: '120.00',
          levelName: 'VIP',
        },
      ],
    });
    const { calls } = withHolds(routes(json(placed, 201)));
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    await hold(1, 1);
    await hold(1, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    const entry = await screen.findByRole('region', { name: 'Early Show' });
    await typeHolderName();
    fireEvent.click(within(entry).getByRole('button', { name: 'Buy tickets' }));

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    const post = calls.find((c) => c.path === '/events/e1/orders');
    // Spec 038 FR-022: no ticket type on a seated order.
    expect(post?.body).toEqual({
      holderName: 'Jordan Lee',
      quantity: 2,
      requestId: expect.any(String),
      seats: [
        { sectionId: 's-a', row: 1, seat: 1 },
        { sectionId: 's-a', row: 1, seat: 3 },
      ],
    });
    const codes = within(done).getByRole('list', { name: 'Ticket codes' });
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'AAAA2222BBBB, Section A, Row 1, Seat 1, VIP, $120.00',
      'CCCC3333DDDD, Section A, Row 1, Seat 3, VIP, $120.00',
    ]);
  });

  it('names taken seats, reads the section again, and keeps the seats still held', async () => {
    let sectionReads = 0;
    const reloaded = seatedMap(
      [
        {
          sectionId: 's-a',
          name: 'A',
          rows: 2,
          seatsPerRow: 3,
          levelId: 'l-vip',
          sold: [
            [1, 2],
            [1, 3],
          ],
        },
        { sectionId: 's-c', name: 'C', rows: 1, seatsPerRow: 2, levelId: 'l-vip' },
        { sectionId: 's-b', name: 'B', rows: 1, seatsPerRow: 4, levelId: 'l-gen' },
      ],
      { levels, seq: 2 },
    );
    const taken = json(
      {
        error: {
          code: 'SEAT_TAKEN',
          message: 'Section A, Row 1, Seat 3 is already taken.',
          details: { seats: [{ section: 'A', row: 1, seat: 3 }] },
        },
      },
      409,
    );
    let holds = 0;
    const { calls } = withHolds(
      routes(undefined, 56, {
        // The second read takes a moment, as over a network, so a redraw would be seen.
        'GET /events/e1/venue-map/sections/s-a': () =>
          sectionReads++ === 0
            ? json(arena().section('s-a'))
            : new Promise<Response>((r) => setTimeout(() => r(json(reloaded.section('s-a'))), 50)),
        'GET /events/e1/venue-map': () => json(sectionReads === 0 ? arena().map : reloaded.map),
        // Spec 015: the taken seat is refused when it is held (spec 033: when clicked).
        'POST /events/e1/reservation': () =>
          holds++ === 0
            ? json(
                {
                  eventId: 'e1',
                  tierId: null,
                  seats: [
                    {
                      sectionId: 's-a',
                      section: 'A',
                      row: 1,
                      seat: 1,
                      rowLabel: '1',
                      seatLabel: '1',
                      levelName: 'VIP',
                      price: '120.00',
                    },
                  ],
                  createdAt: '2026-10-20T19:00:00.000Z',
                  expiresAt: '2026-10-20T19:05:00.000Z',
                  secondsLeft: 300,
                },
                201,
              )
            : taken,
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    await hold(1, 1);
    // No seat stream here (it is not stubbed), so the map is read again by itself.
    const clicked = seatOf(1, 3);
    clicked.focus();
    let redrawn = false;
    const watch = new MutationObserver(() => {
      if (document.body.textContent?.includes('Loading tickets…')) redrawn = true;
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    fireEvent.click(clicked);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Section A, Row 1, Seat 3 is already taken.',
    );
    // Shown as sold once the section is read again; clicked, so it stays focusable, and the form
    // is never redrawn, so the focus stays on it (spec 033 review rounds 1 and 2, M1).
    await vi.waitFor(() =>
      expect(seatOf(1, 3)).toHaveAccessibleName('Row 1, Seat 3, VIP, $120, sold'),
    );
    expect(seatOf(1, 3)).toHaveAttribute('aria-disabled', 'true');
    expect(seatOf(1, 3)).toBe(clicked);
    expect(clicked).toHaveFocus();
    watch.disconnect();
    expect(redrawn).toBe(false);
    expect(chosen()).toEqual(['Section A, Row 1, Seat 1, VIP, $120.00']);
    expect(calls.filter((c) => c.path === '/events/e1/venue-map').length).toBeGreaterThanOrEqual(2);
  });
});

describe('general admission is unchanged (FR-014)', () => {
  it('shows the quantity form, and no seat map, when reserved seating is off', async () => {
    stubApi({ ...routes(), 'GET /events/e1': json(event()) });
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('combobox', { name: 'Quantity' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose seats' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Arena map' })).toBeNull();
  });
});
