import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { Availability, CustomerLimit, SeatMap } from '@queuepass/shared';
import {
  availability,
  event,
  json,
  renderCustomer,
  stubApi,
  tier,
  typeHolderName,
} from './helpers';

/**
 * Spec 016 US4 (FR-012–FR-015; research R8): the Get tickets form shows the customer's limit,
 * never offers more than they may still get, and says when they have reached it.
 */
afterEach(() => vi.unstubAllGlobals());

const limit = (remaining: number, max = 8): CustomerLimit => ({
  limit: max,
  held: max - remaining,
  remaining,
});

type Reply = Response | (() => Response);
const routes = (left: Availability | Reply) => ({
  'GET /events/e1': json(event({ basePrice: '45.50' })),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability':
    left instanceof Response || typeof left === 'function' ? left : json(left),
});

const quantity = () => screen.getByRole('combobox', { name: 'Quantity' });
const options = () =>
  within(quantity())
    .getAllByRole('option')
    .map((o) => Number(o.textContent));
const heading = () => screen.findByRole('heading', { name: 'Get tickets' });

describe('showing the limit (FR-012, FR-013)', () => {
  it('says the limit and how many more, and offers up to that many', async () => {
    stubApi(routes(availability({ customerLimit: limit(8) })));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('Limit: 8 tickets per customer. You can get 8 more.'),
    ).toBeInTheDocument();
    expect(Math.max(...options())).toBe(8);
  });

  it('offers no more than the customer may still get', async () => {
    stubApi(routes(availability({ customerLimit: limit(3) })));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('Limit: 8 tickets per customer. You can get 3 more.'),
    ).toBeInTheDocument();
    expect(options()).toEqual([1, 2, 3]);
  });

  it('lets the tickets left win when they are fewer', async () => {
    stubApi(routes(availability({ ticketsLeft: 2, customerLimit: limit(5) })));
    renderCustomer({ at: '/events/e1' });
    await heading();
    expect(options()).toEqual([1, 2]);
  });

  it('lets the per-order cap of 10 win when it is smaller', async () => {
    stubApi(routes(availability({ customerLimit: limit(20, 20) })));
    renderCustomer({ at: '/events/e1' });
    await heading();
    expect(options()).toHaveLength(10);
  });
});

describe('at the limit (FR-014)', () => {
  it('replaces the form with the reached message and no confirm control', async () => {
    stubApi(routes(availability({ customerLimit: limit(0) })));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('You have reached the limit of 8 tickets for this event.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm order' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Quantity' })).toBeNull();
  });

  it('keeps the sold-out message first', async () => {
    stubApi(routes(availability({ ticketsLeft: 0, customerLimit: limit(0) })));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('Sold out: no tickets are left for this event.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reached the limit/)).toBeNull();
  });

  it('keeps the cancelled message first', async () => {
    stubApi(routes(availability({ salesClosed: 'CANCELLED', customerLimit: limit(0) })));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('No tickets: this event has been cancelled.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reached the limit/)).toBeNull();
  });
});

describe('a refusal for the limit (FR-015)', () => {
  it("shows the Backend's message, keeps the choice, and reloads what is left", async () => {
    let loads = 0;
    const message =
      'Early Show allows 8 tickets per customer. You already hold 4, so you can get 4 more; 5 were requested.';
    const { calls } = stubApi({
      ...routes(() => {
        loads += 1;
        return json(availability({ customerLimit: limit(loads === 1 ? 5 : 4) }));
      }),
      'POST /events/e1/orders': json(
        {
          error: {
            code: 'TICKET_LIMIT_REACHED',
            message,
            details: { limit: 8, held: 4, remaining: 4, requested: 5 },
          },
        },
        409,
      ),
    });
    renderCustomer({ at: '/events/e1' });

    await heading();
    fireEvent.change(quantity(), { target: { value: '4' } });
    await typeHolderName();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    await screen.findByText('Limit: 8 tickets per customer. You can get 4 more.');
    expect(quantity()).toHaveValue('4');
    expect(calls.filter((c) => c.path === '/events/e1/availability')).toHaveLength(2);
  });
});

describe('without a limit (FR-017)', () => {
  it.each([
    ['null', availability({ ticketsLeft: 7, customerLimit: null })],
    ['missing', (({ customerLimit: _, ...rest }) => rest)(availability({ ticketsLeft: 7 }))],
  ])('leaves the form as it was when customerLimit is %s', async (_, left) => {
    stubApi(routes(left as Availability));
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText('$45.50 each, 7 left')).toBeInTheDocument();
    expect(screen.queryByText(/^Limit:/)).toBeNull();
    expect(options()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('choosing seats (US4-3)', () => {
  const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00', quantity: 6 });
  const map: SeatMap = {
    eventId: 'e1',
    reservedSeating: true,
    sections: [
      {
        sectionId: 's-a',
        name: 'A',
        rows: 2,
        seatsPerRow: 3,
        tierId: 't-vip',
        sold: 0,
        taken: [],
        reserved: [],
      },
    ],
  };

  it('stops at what the customer may still get, and says why', async () => {
    stubApi({
      'GET /events/e1': json(event({ reservedSeating: true })),
      'GET /events/e1/tiers': json([vip]),
      'GET /events/e1/availability': json(
        availability({
          ticketsLeft: 6,
          tiers: [{ tierId: 't-vip', ticketsLeft: 6 }],
          customerLimit: limit(2, 3),
        }),
      ),
      'GET /events/e1/seats': json(map),
    });
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    const seat = (s: number) => screen.getByRole('button', { name: `Row 1, Seat ${s}` });
    expect(screen.queryByText(/No more seats can be chosen/)).toBeNull();
    fireEvent.click(seat(1));
    fireEvent.click(seat(2));

    expect(seat(3)).toBeDisabled();
    expect(
      screen.getByText(
        'No more seats can be chosen: the limit of 3 tickets per customer allows you 2 more.',
      ),
    ).toBeInTheDocument();
  });

  it('does not blame the limit when it ties with the seats left (research R3)', async () => {
    stubApi({
      'GET /events/e1': json(event({ reservedSeating: true })),
      'GET /events/e1/tiers': json([vip]),
      'GET /events/e1/availability': json(
        availability({
          ticketsLeft: 2,
          tiers: [{ tierId: 't-vip', ticketsLeft: 2 }],
          customerLimit: limit(2, 3),
        }),
      ),
      'GET /events/e1/seats': json(map),
    });
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Row 1, Seat 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Row 1, Seat 2' }));

    expect(screen.getByRole('button', { name: 'Row 1, Seat 3' })).toBeDisabled();
    expect(screen.queryByText(/No more seats can be chosen/)).toBeNull();
  });
});
