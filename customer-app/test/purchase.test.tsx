import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { availability, event, json, order, renderCustomer, stubApi, tier } from './helpers';

/** Spec 006 US1 (FR-001, FR-004, FR-005): get tickets on the event page. */
afterEach(() => vi.unstubAllGlobals());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00', quantity: 10 });
const general = tier({ id: 't-gen', name: 'General', price: '19.99', quantity: 60 });

const tieredRoutes = (orderReply: Response | (() => Response) = json(order(), 201)) => ({
  'GET /events/e1': json(event()),
  'GET /events/e1/tiers': json([general, vip]),
  'GET /events/e1/availability': json(
    availability({
      ticketsLeft: 56,
      tiers: [
        { tierId: 't-gen', ticketsLeft: 50 },
        { tierId: 't-vip', ticketsLeft: 6 },
      ],
    }),
  ),
  'POST /events/e1/orders': orderReply,
});

const tierlessRoutes = (orderReply: Response = json(order(), 201)) => ({
  'GET /events/e1': json(event({ basePrice: '45.50' })),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 7 })),
  'POST /events/e1/orders': orderReply,
});

const confirmButton = () => screen.findByRole('button', { name: 'Confirm order' });
const quantity = () => screen.getByRole('combobox', { name: 'Quantity' });
const posts = <C extends { method: string }>(calls: C[]): C[] =>
  calls.filter((c) => c.method === 'POST');

describe('choosing tickets (US1-1 to US1-3)', () => {
  it('lists each tier with its price and tickets left, and needs one chosen', async () => {
    stubApi(tieredRoutes());
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('heading', { name: 'Get tickets' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'General, $19.99, 50 left' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'VIP, $120.00, 6 left' })).toBeInTheDocument();
    expect(await confirmButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /VIP/ }));
    expect(await confirmButton()).toBeEnabled();
  });

  it('uses the base price, with no tier choice, for an event without tiers', async () => {
    stubApi(tierlessRoutes());
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText('$45.50 each, 7 left')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(await confirmButton()).toBeEnabled();
  });

  it('offers 1 up to the smaller of 10 and the tickets left', async () => {
    stubApi(tieredRoutes());
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    const vipOptions = within(quantity())
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(vipOptions).toEqual(['1', '2', '3', '4', '5', '6']);

    fireEvent.click(screen.getByRole('radio', { name: /General/ }));
    expect(within(quantity()).getAllByRole('option')).toHaveLength(10);
  });

  it('shows the exact total for the chosen tier and quantity', async () => {
    stubApi(tieredRoutes());
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('radio', { name: /General/ }));
    fireEvent.change(quantity(), { target: { value: '3' } });
    expect(screen.getByText('Total: $59.97')).toBeInTheDocument();
  });
});

describe('confirming (US1-4, US1-5; FR-005)', () => {
  it('sends the tier, quantity, and a new requestId, then shows every ticket code', async () => {
    const placed = order({
      tierId: 't-vip',
      tierName: 'VIP',
      quantity: 2,
      unitPrice: '120.00',
      totalPrice: '240.00',
    });
    const { calls } = stubApi(tieredRoutes(json(placed, 201)));
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    fireEvent.change(quantity(), { target: { value: '2' } });
    fireEvent.click(await confirmButton());

    const done = await screen.findByRole('region', { name: 'Order confirmed' });
    const [post] = posts(calls);
    expect(post.path).toBe('/events/e1/orders');
    expect(post.body).toEqual({ tierId: 't-vip', quantity: 2, requestId: expect.any(String) });
    expect((post.body as { requestId: string }).requestId).toMatch(UUID);

    expect(within(done).getByText('Early Show')).toBeInTheDocument();
    expect(within(done).getByText('VIP')).toBeInTheDocument();
    expect(within(done).getByText('$120.00')).toBeInTheDocument();
    expect(within(done).getByText('$240.00')).toBeInTheDocument();
    const codes = within(done).getByRole('list', { name: 'Ticket codes' });
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['AAAA2222BBBB', 'CCCC3333DDDD']);
    expect(within(done).getByRole('link', { name: 'See all my tickets' })).toHaveAttribute(
      'href',
      '/my-tickets',
    );
  });

  it('omits the tier for an event without tiers', async () => {
    const { calls } = stubApi(tierlessRoutes());
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await confirmButton());
    await screen.findByRole('region', { name: 'Order confirmed' });
    expect(posts(calls)[0].body).toEqual({ quantity: 1, requestId: expect.any(String) });
  });

  it('sends one request when Confirm is clicked twice quickly', async () => {
    const { calls } = stubApi(tierlessRoutes());
    renderCustomer({ at: '/events/e1' });

    const button = await confirmButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole('region', { name: 'Order confirmed' });
    expect(posts(calls)).toHaveLength(1);
  });

  it('records nothing when the customer leaves without confirming', async () => {
    const { calls } = stubApi(tieredRoutes());
    const { unmount } = renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    unmount();
    expect(posts(calls)).toHaveLength(0);
  });
});
