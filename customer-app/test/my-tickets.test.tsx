import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { when } from '../src/format';
import { event, json, myOrder, renderCustomer, stubApi } from './helpers';

/** Spec 006 US3 (FR-008): every order the customer placed, newest first, and its tickets. */
afterEach(() => vi.unstubAllGlobals());

const opener = myOrder({ id: 'o2', createdAt: '2026-10-03T16:00:00.000Z' });
const older = myOrder({
  id: 'o1',
  tierName: 'VIP',
  quantity: 1,
  unitPrice: '120.00',
  totalPrice: '120.00',
  createdAt: '2026-10-01T16:00:00.000Z',
  tickets: [
    {
      id: 'k9',
      code: 'EEEE4444FFFF',
      status: 'VALID',
      checkedInAt: '2026-12-01T23:10:00.000Z',
      seat: null,
    },
  ],
  event: {
    id: 'e2',
    name: 'Late Show',
    startsAt: '2026-12-09T03:00:00.000Z',
    endsAt: '2026-12-09T07:00:00.000Z',
    status: 'SCHEDULED',
    location: { id: 'v2', name: 'Zeta Hall' },
  },
});

const orders = () => screen.findAllByRole('article');

describe('My tickets', () => {
  it('is linked in the header after Events and Venues', async () => {
    stubApi({ 'GET /events': json([event()]) });
    renderCustomer();

    const nav = await screen.findByRole('navigation');
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Events', 'Venues', 'My tickets']);
    expect(within(nav).getByRole('link', { name: 'My tickets' })).toHaveAttribute(
      'href',
      '/my-tickets',
    );
  });

  it("lists the customer's orders in the Backend's order, newest first, with every detail", async () => {
    stubApi({ 'GET /me/orders': json([opener, older]) });
    renderCustomer({ at: '/my-tickets' });

    expect(
      await screen.findByRole('heading', { name: 'My tickets', level: 1 }),
    ).toBeInTheDocument();
    const [first, second] = await orders();
    expect(within(first).getByRole('link', { name: 'Early Show' })).toHaveAttribute(
      'href',
      '/events/e1',
    );
    expect(within(second).getByRole('link', { name: 'Late Show' })).toHaveAttribute(
      'href',
      '/events/e2',
    );

    expect(within(first).getByText('Alpha Arena')).toBeInTheDocument();
    expect(within(first).getByText(when(opener.event.startsAt))).toBeInTheDocument();
    expect(within(first).getByText('$91.00')).toBeInTheDocument();
    expect(within(first).getByText(when(opener.createdAt))).toBeInTheDocument();
    expect(within(first).getByText('Confirmed')).toBeInTheDocument();
    expect(within(second).getByText('VIP')).toBeInTheDocument();
  });

  it('shows each ticket code with Valid, Void, or when it was used', async () => {
    const refunded = myOrder({
      id: 'o3',
      status: 'REFUNDED',
      refundedAt: '2026-10-04T12:00:00.000Z',
      tickets: [{ id: 'k5', code: 'GGGG5555HHHH', status: 'VOID', checkedInAt: null, seat: null }],
      event: { ...opener.event, id: 'e3', name: 'Gone Show', status: 'CANCELLED' },
    });
    stubApi({ 'GET /me/orders': json([opener, older, refunded]) });
    renderCustomer({ at: '/my-tickets' });

    const [first, second, third] = await orders();
    const ticketsOf = (o: HTMLElement) =>
      within(within(o).getByRole('list', { name: 'Tickets' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    expect(ticketsOf(first)).toEqual(['AAAA2222BBBB: Valid', 'CCCC3333DDDD: Valid']);
    expect(ticketsOf(second)).toEqual([`EEEE4444FFFF: Used ${when('2026-12-01T23:10:00.000Z')}`]);
    expect(ticketsOf(third)).toEqual(['GGGG5555HHHH: Void']);
    expect(within(third).getByText('Refunded')).toBeInTheDocument();
    expect(within(third).getByText('This event has been cancelled.')).toBeInTheDocument();
  });

  it('shows the seat of a seated ticket (spec 007 FR-011)', async () => {
    const seated = myOrder({
      id: 'o4',
      tickets: [
        {
          id: 'k7',
          code: 'JJJJ7777KKKK',
          status: 'VALID',
          checkedInAt: null,
          seat: { section: 'A', row: 3, seat: 7 },
        },
      ],
    });
    stubApi({ 'GET /me/orders': json([seated, opener]) });
    renderCustomer({ at: '/my-tickets' });

    const [first, second] = await orders();
    const ticketsOf = (o: HTMLElement) =>
      within(within(o).getByRole('list', { name: 'Tickets' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    expect(ticketsOf(first)).toEqual(['JJJJ7777KKKK, Section A, Row 3, Seat 7: Valid']);
    expect(ticketsOf(second)).toEqual(['AAAA2222BBBB: Valid', 'CCCC3333DDDD: Valid']);
  });

  it('lists ticket codes as rows, not bullets (spec 008 US4)', async () => {
    stubApi({ 'GET /me/orders': json([opener]) });
    renderCustomer({ at: '/my-tickets' });
    const [first] = await orders();
    expect(within(first).getByRole('list', { name: 'Tickets' })).toHaveClass('ticket-list');
  });

  it('says so, with a way to the events, when there are no tickets yet', async () => {
    stubApi({ 'GET /me/orders': json([]) });
    renderCustomer({ at: '/my-tickets' });

    expect(await screen.findByText('You have no tickets yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/events');
  });

  it('shows the shared message when the Backend cannot be reached', async () => {
    stubApi({ 'GET /me/orders': 'network-error' });
    renderCustomer({ at: '/my-tickets' });

    expect(await screen.findByText("Can't reach the QueuePass service.")).toBeInTheDocument();
  });
});
