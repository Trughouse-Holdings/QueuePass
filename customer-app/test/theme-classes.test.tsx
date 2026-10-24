import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { CustomerLimit, SeatMap } from '@queuepass/shared';
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

/**
 * Spec 012 FR-010, FR-014 (research R8, R10): key controls and every status message carry the
 * shared theme's classes, with their text and roles unchanged. jsdom applies no stylesheet, so
 * the classes are what can be proved here; packages/shared/test/theme proves where they come from.
 */
afterEach(() => vi.unstubAllGlobals());

const routes = (orderReply?: Response | (() => Response)) => ({
  'GET /events/e1': json(event()),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 5 })),
  ...(orderReply ? { 'POST /events/e1/orders': orderReply } : {}),
});

const confirm = async () => {
  await typeHolderName();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm order' }));
};

describe('buttons', () => {
  it('the Get tickets confirm button is the primary button', async () => {
    stubApi(routes());
    renderCustomer({ at: '/events/e1' });
    expect(await screen.findByRole('button', { name: 'Confirm order' })).toHaveClass(
      'btn',
      'btn--primary',
    );
  });

  it('Clear filters is the secondary button', async () => {
    stubApi({ 'GET /events': json([]), 'GET /locations': json([]) });
    renderCustomer({ at: '/events?q=zzz' });
    await screen.findByText('No events match your filters.');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toHaveClass('btn', 'btn--ghost');
  });
});

describe('status messages (US3)', () => {
  it('shows an order refusal as an error banner, with the same text', async () => {
    const message = 'Only 1 ticket is left for Early Show; 2 were requested.';
    stubApi(routes(json({ error: { code: 'SOLD_OUT', message } }, 409)));
    renderCustomer({ at: '/events/e1' });

    await confirm();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveClass('banner', 'banner--error');
  });

  it("shows the couldn't-confirm outcome as a warning banner, its parts in one body", async () => {
    let first = true;
    stubApi(
      routes(() => {
        if (first) {
          first = false;
          throw new TypeError('Failed to fetch');
        }
        return json(order(), 200);
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await confirm();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('banner', 'banner--conflict');
    expect(alert).toHaveTextContent("We couldn't confirm whether your order went through.");

    // One body holding both paragraphs and the Check again button, as in the Admin ErrorBanner.
    expect(alert.children).toHaveLength(1);
    const body = alert.children[0] as HTMLElement;
    expect(body).toHaveClass('banner__body');
    expect(body.querySelectorAll(':scope > p')).toHaveLength(2);
    expect(within(body).getByRole('button', { name: 'Check again' })).toHaveClass(
      'btn',
      'btn--ghost',
    );
    expect(within(body).getByRole('link', { name: 'My tickets' })).toHaveAttribute(
      'href',
      '/my-tickets',
    );
  });

  it.each([
    ['tickets left', 'GET /events/e1/availability'],
    ['tiers', 'GET /events/e1/tiers'],
  ])(
    'shows Get tickets as unavailable in an error banner when the %s fail to load',
    async (_, route) => {
      stubApi({ ...routes(), [route]: 'network-error' });
      renderCustomer({ at: '/events/e1' });
      const message = await screen.findByText(
        'Ticket information is unavailable right now. Try again later.',
      );
      expect(message).toHaveClass('banner', 'banner--error');
      // Its text and announcement stay as they were: no role is added (FR-010).
      expect(message).not.toHaveAttribute('role');
    },
  );

  it("shows Can't reach the QueuePass service as an error banner", async () => {
    stubApi({ 'GET /events': 'network-error', 'GET /locations': json([]) });
    renderCustomer({ at: '/events' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Can't reach the QueuePass service.");
    expect(alert).toHaveClass('banner', 'banner--error');
  });
});

// T022 (research R8, R11): 016's ticket-limit lines, with their text unchanged.
describe("016's ticket-limit lines (FR-010)", () => {
  const limit = (remaining: number, max = 8): CustomerLimit => ({
    limit: max,
    held: max - remaining,
    remaining,
  });

  it('shows the limit line as a note', async () => {
    stubApi({
      ...routes(),
      'GET /events/e1/availability': json(availability({ customerLimit: limit(3) })),
    });
    renderCustomer({ at: '/events/e1' });
    expect(
      await screen.findByText('Limit: 8 tickets per customer. You can get 3 more.'),
    ).toHaveClass('note');
  });

  it('shows the reached message as a warning banner', async () => {
    stubApi({
      ...routes(),
      'GET /events/e1/availability': json(availability({ customerLimit: limit(0) })),
    });
    renderCustomer({ at: '/events/e1' });
    expect(
      await screen.findByText('You have reached the limit of 8 tickets for this event.'),
    ).toHaveClass('banner', 'banner--conflict');
  });

  it('shows "No more seats can be chosen" as a note', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Row 1, Seat 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Row 1, Seat 2' }));
    expect(
      screen.getByText(
        'No more seats can be chosen: the limit of 3 tickets per customer allows you 2 more.',
      ),
    ).toHaveClass('note');
  });
});
