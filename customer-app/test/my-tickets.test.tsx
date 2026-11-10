import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { when } from '../src/format';
import { event, json, myOrder, renderCustomer, stubApi, fixTimeBeforeFixtures } from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

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
    doorsOpenAt: '2026-12-09T02:00:00.000Z',
    status: 'SCHEDULED',
    location: { id: 'v2', name: 'Zeta Hall', address: '1 ZETA WAY, LOUISVILLE, KY 40202' },
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
    // Spec 017 FR-012 and spec 018 FR-001: valid, unused tickets also carry Show entry code and
    // Print ticket links.
    expect(ticketsOf(first)).toEqual([
      'AAAA2222BBBB: Valid Show entry code Print ticket',
      'CCCC3333DDDD: Valid Show entry code Print ticket',
    ]);
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
    expect(ticketsOf(first)).toEqual([
      'JJJJ7777KKKK, Section A, Row 3, Seat 7: Valid Show entry code Print ticket',
    ]);
    expect(ticketsOf(second)).toEqual([
      'AAAA2222BBBB: Valid Show entry code Print ticket',
      'CCCC3333DDDD: Valid Show entry code Print ticket',
    ]);
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

describe('names on tickets (spec 017 FR-004, FR-005)', () => {
  it('shows "Name on tickets: Jordan Lee" on each order with a name', async () => {
    stubApi({ 'GET /me/orders': json([opener]) });
    renderCustomer({ at: '/my-tickets' });

    const [first] = await orders();
    expect(within(first).getByText('Jordan Lee')).toBeInTheDocument();
    expect(within(first).getByText('Name on tickets')).toBeInTheDocument();
  });

  it('shows "No name on ticket" when holderName is null (an order from before 017)', async () => {
    stubApi({ 'GET /me/orders': json([myOrder({ holderName: null })]) });
    renderCustomer({ at: '/my-tickets' });

    const [first] = await orders();
    expect(within(first).getByText('No name on ticket')).toBeInTheDocument();
  });
});

/**
 * Spec 030 US2 (FR-015, FR-016; research R8): orders for events that have not ended first, then a
 * Past heading and the rest, each in the API's order (newest first), decided when the page loads.
 */
describe('upcoming, then Past (spec 030)', () => {
  const NOW = Date.parse('2026-11-09T17:00:00.000Z');
  const HOUR = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const ahead = myOrder({
    id: 'o5',
    createdAt: iso(NOW - 48 * HOUR),
    event: {
      ...myOrder().event,
      id: 'e5',
      name: 'Coming Soon',
      startsAt: iso(NOW + 7 * 24 * HOUR),
      endsAt: iso(NOW + 7 * 24 * HOUR + 3 * HOUR),
      doorsOpenAt: iso(NOW + 7 * 24 * HOUR - HOUR),
    },
  });
  // Newer than `ahead`, so the API sends it first.
  const ended = myOrder({
    id: 'o6',
    createdAt: iso(NOW - 24 * HOUR),
    tickets: [{ id: 'k6', code: 'MMMM8888NNNN', status: 'VALID', checkedInAt: null, seat: null }],
    event: {
      ...myOrder().event,
      id: 'e6',
      name: 'Ended Show',
      startsAt: iso(NOW - 4 * HOUR),
      endsAt: iso(NOW - 60_000),
      doorsOpenAt: iso(NOW - 5 * HOUR),
    },
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  /** The page's order-card names and the Past heading, top to bottom. */
  const outline = () =>
    Array.from(document.querySelectorAll('#past-orders, article h2, article h3')).map(
      (h) => h.textContent,
    );

  it('lists upcoming orders first, then Past, keeping every order', async () => {
    stubApi({ 'GET /me/orders': json([ended, ahead]) });
    renderCustomer({ at: '/my-tickets' });

    await screen.findByRole('heading', { name: 'Past', level: 2 });
    expect(outline()).toEqual(['Coming Soon', 'Past', 'Ended Show']);
    expect(await orders()).toHaveLength(2);
  });

  // Implementation review round 1, S1 (Constitution VII): heading navigation shows which orders
  // are past.
  it('puts past orders in the Past section, their headings one level below it', async () => {
    stubApi({ 'GET /me/orders': json([ended, ahead]) });
    renderCustomer({ at: '/my-tickets' });

    const section = await screen.findByRole('region', { name: 'Past' });
    expect(
      within(section).getByRole('heading', { level: 3, name: 'Ended Show' }),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('heading', { name: 'Coming Soon' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Coming Soon' })).toBeInTheDocument();
  });

  it('under Past, a valid unused ticket can be printed but offers no entry code', async () => {
    stubApi({ 'GET /me/orders': json([ended, ahead]) });
    renderCustomer({ at: '/my-tickets' });

    const [upcoming, past] = await orders();
    expect(within(upcoming).getAllByRole('link', { name: /^Show entry code/ })).toHaveLength(2);
    expect(within(upcoming).getAllByRole('link', { name: /^Print ticket/ })).toHaveLength(2);
    expect(within(past).queryByRole('link', { name: /^Show entry code/ })).not.toBeInTheDocument();
    expect(within(past).getByRole('link', { name: 'Print ticket MMMM8888NNNN' })).toHaveAttribute(
      'href',
      '/my-tickets/k6/print',
    );
    expect(within(past).getByText(/MMMM8888NNNN: Valid/)).toBeInTheDocument();
  });

  it('with only past orders, says there are no upcoming tickets, then Past', async () => {
    stubApi({ 'GET /me/orders': json([ended]) });
    renderCustomer({ at: '/my-tickets' });

    expect(await screen.findByText('You have no upcoming tickets.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/events');
    expect(outline()).toEqual(['Past', 'Ended Show']);
  });

  it('with only upcoming orders, shows no Past heading', async () => {
    stubApi({ 'GET /me/orders': json([ahead]) });
    renderCustomer({ at: '/my-tickets' });

    await orders();
    expect(screen.queryByRole('heading', { name: 'Past' })).not.toBeInTheDocument();
    expect(screen.queryByText('You have no upcoming tickets.')).not.toBeInTheDocument();
  });

  it('with no orders, says there are no tickets yet, and no Past heading', async () => {
    stubApi({ 'GET /me/orders': json([]) });
    renderCustomer({ at: '/my-tickets' });

    expect(await screen.findByText('You have no tickets yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Past' })).not.toBeInTheDocument();
  });
});
