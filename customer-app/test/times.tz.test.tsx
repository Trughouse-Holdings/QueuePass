import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { keyToBase64url, type Location } from '@queuepass/shared';
import { availability, event, json, myOrder, renderCustomer, stubApi, venue } from './helpers';

/**
 * Spec 020 US1 (FR-021, FR-022, SC-002, SC-003; research R12): every event time in the Customer
 * app is the venue's local time with its abbreviation, identical under any device zone
 * (`npm run test:tz` runs this file under four; CI reruns it in America/Los_Angeles).
 */
afterEach(() => vi.unstubAllGlobals());

const EAST = venue({ id: 'v-east', name: 'Riverside', timeZone: 'America/New_York' });
const PHX = venue({ id: 'v-phx', name: 'Phoenix Hall', timeZone: 'America/Phoenix' });
const HNL = venue({ id: 'v-hnl', name: 'Ward Hall', timeZone: 'Pacific/Honolulu' });

/** 7:00 PM to 10:00 PM local on Oct 1, 2026 at each venue. */
const at = (id: string, name: string, v: Location, startsAt: string, endsAt: string) =>
  event({ id, name, location: v, locationId: v.id, startsAt, endsAt });
const E_EAST = at(
  'e-east',
  'East Show',
  EAST,
  '2026-10-01T23:00:00.000Z',
  '2026-10-02T02:00:00.000Z',
);
const E_PHX = at(
  'e-phx',
  'Desert Show',
  PHX,
  '2026-10-02T02:00:00.000Z',
  '2026-10-02T05:00:00.000Z',
);
const E_HNL = at(
  'e-hnl',
  'Island Show',
  HNL,
  '2026-10-02T05:00:00.000Z',
  '2026-10-02T08:00:00.000Z',
);
const EXPECTED: [string, string, string][] = [
  ['East Show', 'Oct 1, 2026, 7:00 PM EDT', 'Oct 1, 2026, 10:00 PM EDT'],
  ['Desert Show', 'Oct 1, 2026, 7:00 PM MST', 'Oct 1, 2026, 10:00 PM MST'],
  ['Island Show', 'Oct 1, 2026, 7:00 PM HST', 'Oct 1, 2026, 10:00 PM HST'],
];

const card = (name: string) => screen.getByRole('link', { name }).closest('article') as HTMLElement;

describe('event cards (Events list)', () => {
  it("show each event's start and end in its venue's zone", async () => {
    stubApi({
      'GET /events': json([E_EAST, E_PHX, E_HNL]),
      'GET /locations': json([EAST, PHX, HNL]),
    });
    renderCustomer();
    await screen.findByRole('link', { name: 'East Show' });
    for (const [name, starts, ends] of EXPECTED) {
      expect(within(card(name)).getByText(starts)).toBeInTheDocument();
      expect(within(card(name)).getByText(ends)).toBeInTheDocument();
    }
  });

  it('read a missing zone as Eastern (contract Location)', async () => {
    const legacy = venue({ id: 'v-old', name: 'Old Hall' });
    expect(legacy.timeZone).toBeUndefined();
    stubApi({
      'GET /events': json([
        at('e-old', 'Old Show', legacy, '2026-12-02T01:00:00.000Z', '2026-12-02T03:00:00.000Z'),
      ]),
      'GET /locations': json([legacy]),
    });
    renderCustomer();
    await screen.findByRole('link', { name: 'Old Show' });
    expect(within(card('Old Show')).getByText('Dec 1, 2026, 8:00 PM EST')).toBeInTheDocument();
  });
});

describe('the venue page', () => {
  it("lists the venue's events in its zone", async () => {
    stubApi({ [`GET /locations/${PHX.id}`]: json(PHX), 'GET /events': json([E_PHX]) });
    renderCustomer({ at: `/venues/${PHX.id}` });
    await screen.findByRole('link', { name: 'Desert Show' });
    expect(within(card('Desert Show')).getByText('Oct 1, 2026, 7:00 PM MST')).toBeInTheDocument();
  });
});

describe('the event page', () => {
  it.each([
    [E_EAST, EXPECTED[0]],
    [E_PHX, EXPECTED[1]],
    [E_HNL, EXPECTED[2]],
  ])('shows %# in its venue zone', async (e, [name, starts, ends]) => {
    stubApi({
      [`GET /events/${e.id}`]: json(e),
      [`GET /events/${e.id}/tiers`]: json([]),
      [`GET /events/${e.id}/availability`]: json(availability({ eventId: e.id })),
    });
    renderCustomer({ at: `/events/${e.id}` });
    expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByText(starts)).toBeInTheDocument();
    expect(screen.getByText(ends)).toBeInTheDocument();
  });
});

describe('My tickets, the live entry code, and the printable ticket', () => {
  const base = myOrder();
  const order = myOrder({
    event: {
      id: E_PHX.id,
      name: E_PHX.name,
      startsAt: E_PHX.startsAt,
      endsAt: E_PHX.endsAt,
      status: 'SCHEDULED',
      location: { id: PHX.id, name: PHX.name, address: PHX.address, timeZone: 'America/Phoenix' },
    },
    createdAt: '2026-09-15T18:30:00.000Z', // 11:30 AM MST
    // The first ticket was used at 6:45 PM MST.
    tickets: base.tickets.map((t, i) =>
      i === 0 ? { ...t, checkedInAt: '2026-10-02T01:45:00.000Z' } : t,
    ),
  });
  const valid = order.tickets.find((t) => t.checkedInAt === null)!;

  it('My tickets shows the start, the order time, and the used time in the venue zone', async () => {
    stubApi({ 'GET /me/orders': json([order]) });
    renderCustomer({ at: '/my-tickets' });
    expect(await screen.findByText('Oct 1, 2026, 7:00 PM MST')).toBeInTheDocument();
    expect(screen.getByText('Sep 15, 2026, 11:30 AM MST')).toBeInTheDocument();
    expect(screen.getByText(/Used Oct 1, 2026, 6:45 PM MST/)).toBeInTheDocument();
  });

  it('the printable ticket shows the start in the venue zone', async () => {
    stubApi({ 'GET /me/orders': json([order]) });
    renderCustomer({ at: `/my-tickets/${valid.id}/print` });
    expect(await screen.findByText('Oct 1, 2026, 7:00 PM MST')).toBeInTheDocument();
  });

  it('the live entry code page shows the start in the venue zone', async () => {
    stubApi({
      'GET /me/orders': json([order]),
      [`GET /me/tickets/${valid.id}/entry-key`]: json({
        ticketId: valid.id,
        key: keyToBase64url(new Uint8Array(32)),
        serverTime: new Date().toISOString(),
      }),
    });
    renderCustomer({ at: `/my-tickets/${valid.id}/entry-code` });
    expect(await screen.findByText('Oct 1, 2026, 7:00 PM MST')).toBeInTheDocument();
  });
});
