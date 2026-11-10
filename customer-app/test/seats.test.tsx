import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { SeatMap } from '@queuepass/shared';
import {
  availability,
  event,
  holdBackend,
  json,
  order,
  renderCustomer,
  stubApi,
  tier,
  typeHolderName,
  fixTimeBeforeFixtures,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 007 US2 (FR-007, FR-008, FR-011): choosing seats in the Get tickets form; since spec 033
 * each click holds the seat at once, and the seats are bought from the cart.
 */
afterEach(() => vi.unstubAllGlobals());

const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00', quantity: 30 });
const general = tier({ id: 't-gen', name: 'General', price: '40.00', quantity: 40 });

const seatMap = (over: Partial<SeatMap> = {}): SeatMap => ({
  eventId: 'e1',
  reservedSeating: true,
  sections: [
    {
      sectionId: 's-a',
      name: 'A',
      rows: 2,
      seatsPerRow: 3,
      tierId: 't-vip',
      sold: 1,
      taken: [{ row: 1, seat: 2 }],
      reserved: [],
    },
    {
      sectionId: 's-c',
      name: 'C',
      rows: 1,
      seatsPerRow: 2,
      tierId: 't-vip',
      sold: 0,
      taken: [],
      reserved: [],
    },
    {
      sectionId: 's-b',
      name: 'B',
      rows: 1,
      seatsPerRow: 4,
      tierId: 't-gen',
      sold: 0,
      taken: [],
      reserved: [],
    },
  ],
  ...over,
});

type Reply = Response | ((req: Request) => Response | Promise<Response>);
const routes = (
  map: Reply = json(seatMap()),
  orderReply?: Reply,
  left = 56,
  reserveReply?: Reply,
) => ({
  'GET /events/e1': json(event({ reservedSeating: true })),
  'GET /events/e1/tiers': json([general, vip]),
  'GET /events/e1/availability': json(
    availability({
      ticketsLeft: left,
      tiers: [
        { tierId: 't-gen', ticketsLeft: 40 },
        { tierId: 't-vip', ticketsLeft: Math.min(16, left) },
      ],
    }),
  ),
  'GET /events/e1/seats': map,
  ...(orderReply ? { 'POST /events/e1/orders': orderReply } : {}),
  // Spec 015 FR-006: seats are reserved before they are ordered.
  ...(reserveReply ? { 'POST /events/e1/reservation': reserveReply } : {}),
});
/** Spec 033: seat clicks answered by a hold backend, on top of `routes`. */
const withHolds = (r: Record<string, Reply> = routes()) => {
  const b = holdBackend({ sections: { 's-a': 'A', 's-c': 'C', 's-b': 'B' } });
  return stubApi({
    ...r,
    ...b.routes,
    ...Object.fromEntries(Object.entries(r).filter(([k]) => k === 'POST /events/e1/reservation')),
  });
};
/** Clicks a seat and waits for it to be held. */
const hold = async (row: number, seat: number) => {
  fireEvent.click(seatButton(row, seat));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: `Row ${row}, Seat ${seat}, reserved by you` }),
    ).toBeInTheDocument(),
  );
};

/** Spec 015: the reservation the Backend answers for these seats of section A. */
const reservationOf = (seats: [number, number][]) =>
  json(
    {
      eventId: 'e1',
      tierId: 't-vip',
      seats: seats.map(([row, seat]) => ({ sectionId: 's-a', section: 'A', row, seat })),
      createdAt: '2026-10-20T19:00:00.000Z',
      expiresAt: '2026-10-20T19:05:00.000Z',
      secondsLeft: 300,
    },
    201,
  );

const chooseTier = async (name: RegExp) =>
  fireEvent.click(await screen.findByRole('radio', { name }));
const chooseSection = (name: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Section' }), {
    target: {
      value: screen.getByRole('option', { name: `Section ${name}` }).getAttribute('value'),
    },
  });
// Spec 015 FR-012: a sold seat's name ends ", sold" (and a reserved one's ", reserved").
const seatButton = (row: number, seat: number) =>
  screen.getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${seat}(, [a-z ]+)?$`) });
const chosen = () => {
  const box = screen.queryByRole('region', { name: 'Your seats' });
  return box
    ? within(box)
        .queryAllByRole('listitem')
        .map((li) => li.textContent)
    : [];
};

describe('choosing seats (US2-1, US2-2; FR-007)', () => {
  it("offers only the chosen tier's sections, then that section's seats", async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    const sections = within(screen.getByRole('combobox', { name: 'Section' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(sections).toEqual(['Section A', 'Section C']);

    chooseSection('A');
    expect(seatButton(1, 1)).toHaveAttribute('aria-pressed', 'false');
    expect(seatButton(1, 2)).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /^Row \d+, Seat \d+(, [a-z ]+)?$/ })).toHaveLength(
      6,
    );
  });

  it('lists held seats, keeps them across sections of the tier, and totals them', async () => {
    withHolds();
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    await hold(1, 1);
    await hold(2, 3);
    expect(seatButton(1, 1)).toHaveAttribute('aria-pressed', 'true');

    chooseSection('C');
    await hold(1, 2);

    expect(chosen()).toEqual([
      'Section A, Row 1, Seat 1',
      'Section A, Row 2, Seat 3',
      'Section C, Row 1, Seat 2',
    ]);
    expect(screen.getByText('Total: $360.00')).toBeInTheDocument();

    // Spec 033 FR-001: a click on a held seat releases it; there is no Remove.
    chooseSection('A');
    fireEvent.click(seatButton(2, 3));
    await waitFor(() => expect(chosen()).toHaveLength(2));
    expect(screen.getByText('Total: $240.00')).toBeInTheDocument();
  });

  it('changes the tier freely while no seat is held', async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    await chooseTier(/General/);

    expect(screen.getByRole('radio', { name: /General/ })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Section B seats' })).toBeInTheDocument();
    expect(chosen()).toEqual([]);
  });

  it('allows no more seats than the tickets left (and never more than 10)', async () => {
    withHolds(routes(json(seatMap()), undefined, 2));
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    await hold(1, 1);
    await hold(1, 3);

    expect(seatButton(2, 1)).toBeDisabled();
    expect(seatButton(1, 1)).toBeEnabled();
  });
});

describe('seat states beyond color (spec 008 US3; FR-008)', () => {
  it('marks held seats with a clock, taken seats with a cross, and keeps their names', async () => {
    withHolds();
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    await hold(1, 1);

    expect(seatButton(1, 1)).toHaveAttribute('aria-pressed', 'true');
    expect(seatButton(1, 1)).toHaveTextContent('⏱1');
    expect(seatButton(1, 2)).toBeDisabled();
    expect(seatButton(1, 2)).toHaveTextContent('✕');
    expect(seatButton(1, 2)).not.toHaveTextContent('2');
    expect(seatButton(1, 3)).toHaveTextContent(/^3$/);
    expect(seatButton(1, 3)).toHaveAttribute('aria-pressed', 'false');
  });

  it("puts each section's seats in their own scrollable region", async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    const region = screen.getByRole('region', { name: 'Section A seats' });
    expect(region).toHaveClass('seat-scroll');
    expect(
      within(region).getAllByRole('button', { name: /^Row \d+, Seat \d+(, [a-z ]+)?$/ }),
    ).toHaveLength(6);
  });
});

describe('a tier with no seats on sale (FR-006)', () => {
  it('is disabled and says why, instead of offering an empty seat map', async () => {
    const unmapped = seatMap();
    unmapped.sections = unmapped.sections.map((x) => ({
      ...x,
      tierId: x.tierId === 't-vip' ? null : x.tierId,
    }));
    stubApi(routes(json(unmapped)));
    renderCustomer({ at: '/events/e1' });

    const vipRadio = await screen.findByRole('radio', { name: 'VIP, $120.00, no seats on sale' });
    expect(vipRadio).toBeDisabled();
    expect(screen.getByRole('radio', { name: /General/ })).toBeEnabled();
  });

  it('shows a tier at its quantity as sold out, though its sections have open seats', async () => {
    const r = routes();
    r['GET /events/e1/availability'] = json(
      availability({
        ticketsLeft: 40,
        tiers: [
          { tierId: 't-gen', ticketsLeft: 40 },
          { tierId: 't-vip', ticketsLeft: 0 },
        ],
      }),
    );
    stubApi(r);
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('radio', { name: 'VIP, $120.00, sold out' })).toBeDisabled();
  });

  it('says no seats are on sale when no tier has a section', async () => {
    const unmapped = seatMap();
    unmapped.sections = unmapped.sections.map((x) => ({ ...x, tierId: null }));
    stubApi(routes(json(unmapped)));
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText('No seats are on sale for this event yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /seats$/ })).toBeNull();
  });
});

describe('confirming seats (US2-3; FR-008, FR-011)', () => {
  it('sends the seats and their count, then lists each code with its seat', async () => {
    const placed = order({
      tierId: 't-vip',
      tierName: 'VIP',
      quantity: 2,
      unitPrice: '120.00',
      totalPrice: '240.00',
      tickets: [
        {
          id: 'k1',
          code: 'AAAA2222BBBB',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: 'A', row: 1, seat: 1 },
        },
        {
          id: 'k2',
          code: 'CCCC3333DDDD',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: 'A', row: 1, seat: 3 },
        },
      ],
    });
    const { calls } = withHolds(routes(json(seatMap()), json(placed, 201)));
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    await hold(1, 1);
    await hold(1, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    const entry = await screen.findByRole('region', { name: 'Early Show' });
    await typeHolderName();
    fireEvent.click(within(entry).getByRole('button', { name: 'Buy tickets' }));

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    const post = calls.find((c) => c.path === '/events/e1/orders');
    expect(post?.body).toEqual({
      tierId: 't-vip',
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
    ).toEqual(['AAAA2222BBBB, Section A, Row 1, Seat 1', 'CCCC3333DDDD, Section A, Row 1, Seat 3']);
  });

  it('names taken seats, reloads the map, and keeps the seats still held', async () => {
    let maps = 0;
    const reloaded = seatMap();
    reloaded.sections[0].taken = [
      { row: 1, seat: 2 },
      { row: 1, seat: 3 },
    ];
    let holds = 0;
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
    const { calls } = withHolds(
      routes(
        // The second read takes a moment, as over a network, so a redraw would be seen.
        () =>
          maps++ === 0
            ? json(seatMap())
            : new Promise<Response>((r) => setTimeout(() => r(json(reloaded)), 50)),
        undefined,
        56,
        // Spec 015: the taken seat is refused when it is held (spec 033: when clicked).
        () => (holds++ === 0 ? reservationOf([[1, 1]]) : taken),
      ),
    );
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    await hold(1, 1);
    // No seat stream here (it is not stubbed), so the map is read again by itself.
    const clicked = seatButton(1, 3);
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
    // Shown as sold once the map is read again; clicked, so it stays focusable, and the form is
    // never redrawn, so the focus stays on it (spec 033 review rounds 1 and 2, M1).
    await vi.waitFor(() => expect(seatButton(1, 3)).toHaveAccessibleName('Row 1, Seat 3, sold'));
    expect(seatButton(1, 3)).toHaveAttribute('aria-disabled', 'true');
    expect(seatButton(1, 3)).toBe(clicked);
    expect(clicked).toHaveFocus();
    watch.disconnect();
    expect(redrawn).toBe(false);
    expect(chosen()).toEqual(['Section A, Row 1, Seat 1']);
    expect(calls.filter((c) => c.path === '/events/e1/seats').length).toBeGreaterThanOrEqual(2);
  });
});

describe('general admission is unchanged (FR-014)', () => {
  it('shows the quantity form, and no seat map, when reserved seating is off', async () => {
    stubApi(routes(json(seatMap({ reservedSeating: false }))));
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('combobox', { name: 'Quantity' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Section' })).toBeNull();
  });
});
