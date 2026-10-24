import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { SeatMap } from '@queuepass/shared';
import {
  availability,
  event,
  json,
  order,
  renderCustomer,
  stubApi,
  tier,
  typeHolderName,
} from './helpers';

/** Spec 007 US2 (FR-007, FR-008, FR-011): choosing seats in the Get tickets form. */
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

type Reply = Response | (() => Response);
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
const chosen = () =>
  within(screen.getByRole('list', { name: 'Chosen seats' }))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);

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

  it('lists chosen seats, keeps them across sections of the tier, and totals them', async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    fireEvent.click(seatButton(1, 1));
    fireEvent.click(seatButton(2, 3));
    expect(seatButton(1, 1)).toHaveAttribute('aria-pressed', 'true');

    chooseSection('C');
    fireEvent.click(seatButton(1, 2));

    expect(chosen()).toEqual([
      'Section A, Row 1, Seat 1',
      'Section A, Row 2, Seat 3',
      'Section C, Row 1, Seat 2',
    ]);
    expect(screen.getByText('Total: $360.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Section A, Row 2, Seat 3' }));
    expect(chosen()).toHaveLength(2);
    expect(screen.getByText('Total: $240.00')).toBeInTheDocument();
  });

  it('clears chosen seats when the tier changes', async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    fireEvent.click(seatButton(1, 1));
    await chooseTier(/General/);

    expect(chosen()).toEqual([]);
  });

  it('allows no more seats than the tickets left (and never more than 10)', async () => {
    stubApi(routes(json(seatMap()), undefined, 2));
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    fireEvent.click(seatButton(1, 1));
    fireEvent.click(seatButton(1, 3));

    expect(seatButton(2, 1)).toBeDisabled();
    expect(seatButton(1, 1)).toBeEnabled();
  });
});

describe('seat states beyond color (spec 008 US3; FR-008)', () => {
  it('marks chosen seats with a check, taken seats with a cross, and keeps their names', async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    fireEvent.click(seatButton(1, 1));

    expect(seatButton(1, 1)).toHaveAttribute('aria-pressed', 'true');
    expect(seatButton(1, 1)).toHaveTextContent('✓1');
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
    expect(screen.queryByRole('button', { name: 'Reserve seats' })).toBeNull();
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
    const { calls } = stubApi(
      routes(
        json(seatMap()),
        json(placed, 201),
        56,
        reservationOf([
          [1, 1],
          [1, 3],
        ]),
      ),
    );
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    fireEvent.click(seatButton(1, 1));
    fireEvent.click(seatButton(1, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Reserve seats' }));
    await typeHolderName();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm purchase' }));

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

  it('names taken seats, reloads the map, and keeps the seats still open', async () => {
    let maps = 0;
    const reloaded = seatMap();
    reloaded.sections[0].taken = [
      { row: 1, seat: 2 },
      { row: 1, seat: 3 },
    ];
    const { calls } = stubApi(
      routes(
        () => json(maps++ === 0 ? seatMap() : reloaded),
        undefined,
        56,
        // Spec 015: the taken seat is now refused at Reserve seats.
        json(
          {
            error: {
              code: 'SEAT_TAKEN',
              message: 'Section A, Row 1, Seat 3 is already taken.',
              details: { seats: [{ section: 'A', row: 1, seat: 3 }] },
            },
          },
          409,
        ),
      ),
    );
    renderCustomer({ at: '/events/e1' });

    await chooseTier(/VIP/);
    chooseSection('A');
    fireEvent.click(seatButton(1, 1));
    fireEvent.click(seatButton(1, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Reserve seats' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Section A, Row 1, Seat 3 is already taken.',
    );
    await vi.waitFor(() => expect(seatButton(1, 3)).toBeDisabled());
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
