import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { Availability } from '@queuepass/shared';
import { availability, event, json, order, renderCustomer, stubApi, tier, typeHolderName } from './helpers';

/** Spec 006 US2 (FR-002, FR-006, FR-014): why tickets can't be had, and refusals explained. */
afterEach(() => vi.unstubAllGlobals());

type Reply = Response | (() => Response) | 'network-error';

const routes = (left: Partial<Availability>, orderReply?: Reply, tiers = [] as unknown[]) => ({
  'GET /events/e1': json(event()),
  'GET /events/e1/tiers': json(tiers),
  'GET /events/e1/availability': json(availability(left)),
  ...(orderReply ? { 'POST /events/e1/orders': orderReply } : {}),
});

const refusal = (code: string, message: string, status = 409) =>
  json({ error: { code, message } }, status);

/** Replies with each response in turn, repeating the last. */
const inTurn = (...replies: Response[]) => {
  let i = 0;
  return () => replies[Math.min(i++, replies.length - 1)];
};

const confirm = async () => {
  await typeHolderName();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm order' }));
};
const requestIds = (calls: { method: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST').map((c) => (c.body as { requestId: string }).requestId);

describe('unavailable before trying (US2-1 to US2-3, US2-5, US2-6)', () => {
  it('disables and marks a sold-out tier', async () => {
    const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00' });
    stubApi(
      routes({ ticketsLeft: 5, tiers: [{ tierId: 't-vip', ticketsLeft: 0 }] }, undefined, [vip]),
    );
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('radio', { name: 'VIP, $120.00, sold out' })).toBeDisabled();
  });

  it('shows Sold out, and no form, when the event has no tickets left', async () => {
    stubApi(routes({ ticketsLeft: 0 }));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('Sold out: no tickets are left for this event.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm order' })).toBeNull();
  });

  it('stops the quantity at the tickets left', async () => {
    stubApi(routes({ ticketsLeft: 3 }));
    renderCustomer({ at: '/events/e1' });

    const select = await screen.findByRole('combobox', { name: 'Quantity' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['1', '2', '3']);
  });

  it('offers no form for a cancelled event', async () => {
    stubApi(routes({ salesClosed: 'CANCELLED' }));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('No tickets: this event has been cancelled.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm order' })).toBeNull();
  });

  it('shows Sales closed, and no form, once the event has started', async () => {
    stubApi(routes({ salesClosed: 'STARTED' }));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('Sales closed: this event has already started.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm order' })).toBeNull();
  });
});

describe('status badges (spec 008 US3-2)', () => {
  const badge = (name: string) => screen.findByText(name, { selector: '.pill' });

  it('badges a sold-out tier without changing its name', async () => {
    const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00' });
    stubApi(
      routes({ ticketsLeft: 5, tiers: [{ tierId: 't-vip', ticketsLeft: 0 }] }, undefined, [vip]),
    );
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('radio', { name: 'VIP, $120.00, sold out' })).toBeDisabled();
    expect(await badge('Sold out')).toBeInTheDocument();
  });

  it.each([
    [{ ticketsLeft: 0 }, 'Sold out'],
    [{ salesClosed: 'CANCELLED' as const }, 'Cancelled'],
    [{ salesClosed: 'STARTED' as const }, 'Sales closed'],
  ])('badges an unavailable event (%o) as %s, keeping its message', async (left, name) => {
    stubApi(routes(left));
    renderCustomer({ at: '/events/e1' });
    expect(await badge(name)).toBeInTheDocument();
  });
});

describe('refused on confirm (US2-4; FR-006)', () => {
  it.each([
    ['SOLD_OUT', 'Only 1 ticket is left for Early Show; 2 were requested.'],
    ['EVENT_CANCELLED', 'Early Show is cancelled and can no longer be changed or sold.'],
    ['SALES_CLOSED', 'Sales for Early Show closed when it started.'],
  ])(
    'shows the %s message, reloads what is left, and starts a new confirmation',
    async (c, message) => {
      const { calls } = stubApi(
        routes({ ticketsLeft: 5 }, inTurn(refusal(c, message), json(order(), 201))),
      );
      renderCustomer({ at: '/events/e1' });

      await confirm();
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      // The reload is sent just after the refusal shows, so wait for it rather than check at once.
      await vi.waitFor(() =>
        expect(
          calls.filter((x) => x.path === '/events/e1/availability').length,
        ).toBeGreaterThanOrEqual(2),
      );

      await confirm();
      await screen.findByRole('region', { name: 'Order confirmed' });
      const [first, second] = requestIds(calls);
      expect(second).not.toBe(first);
    },
  );

  it('shows a validation refusal the same way', async () => {
    stubApi(
      routes(
        { ticketsLeft: 5 },
        refusal('VALIDATION_FAILED', 'quantity must be between 1 and 10', 400),
      ),
    );
    renderCustomer({ at: '/events/e1' });

    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('quantity must be between 1 and 10');
  });

  it('sends the customer back through sign-in on a 401, with no outcome shown', async () => {
    stubApi(routes({ ticketsLeft: 5 }, refusal('UNAUTHENTICATED', 'x', 401)));
    const { um } = renderCustomer({ at: '/events/e1' });

    await confirm();
    await vi.waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('unknown outcome (edge case; FR-006)', () => {
  it.each([
    ['no answer', 'network-error' as const],
    ['a server error', json({ error: { code: 'NOT_FOUND', message: 'x' } }, 500)],
  ])(
    'never claims failure after %s, and Check again repeats the same request',
    async (_, reply) => {
      let first = true;
      const { calls } = stubApi(
        routes({ ticketsLeft: 5 }, () => {
          if (first) {
            first = false;
            if (reply === 'network-error') throw new TypeError('Failed to fetch');
            return reply;
          }
          return json(order(), 200);
        }),
      );
      renderCustomer({ at: '/events/e1' });

      await confirm();
      const notice = await screen.findByRole('alert');
      expect(notice).toHaveTextContent("We couldn't confirm whether your order went through.");
      expect(within(notice).getByRole('link', { name: 'My tickets' })).toHaveAttribute(
        'href',
        '/my-tickets',
      );

      fireEvent.click(within(notice).getByRole('button', { name: 'Check again' }));
      await screen.findByRole('region', { name: 'Order confirmed' });
      const [firstId, secondId] = requestIds(calls);
      expect(secondId).toBe(firstId);
    },
  );
});
