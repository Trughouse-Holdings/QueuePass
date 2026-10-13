/** Shared payloads for the spec 005 Admin tests, shaped like contracts/openapi.yaml 1.3.0. */
export const VENUE = {
  id: '6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e',
  name: 'Yum Center',
  address: '1 Arena Plaza',
  seatingCapacity: 22090,
  createdAt: '2026-09-20T18:57:51.352Z',
  updatedAt: '2026-09-20T18:57:51.352Z',
};

export const EVENT = {
  id: 'b92fc02c-6013-470d-a3bf-bf53648b0ebc',
  name: 'Season Opener',
  locationId: VENUE.id,
  location: VENUE,
  startsAt: '2026-11-01T23:00:00.000Z',
  endsAt: '2026-11-02T02:00:00.000Z',
  totalTicketCapacity: 100,
  maxTicketsPerCustomer: null,
  basePrice: '45.00',
  status: 'SCHEDULED',
  cancelledAt: null,
  reservedSeating: false,
  createdAt: VENUE.createdAt,
  updatedAt: VENUE.updatedAt,
};

export const CANCELLED_EVENT = {
  ...EVENT,
  status: 'CANCELLED',
  cancelledAt: '2026-10-01T12:00:00.000Z',
  reservedSeating: false,
};

export const GENERAL_ID = '11111111-1111-4111-8111-111111111111';
export const VIP_ID = '22222222-2222-4222-8222-222222222222';

export const REPORT = {
  generatedAt: '2026-10-01T12:00:00.000Z',
  totals: { events: 2, ticketCapacity: 300, ticketsSold: 75, checkedIn: 12, revenue: '4321.50' },
  events: [
    {
      eventId: EVENT.id,
      name: 'Season Opener',
      venueName: 'Yum Center',
      startsAt: EVENT.startsAt,
      status: 'SCHEDULED',
      ticketCapacity: 100,
      ticketsSold: 25,
      checkedIn: 12,
      revenue: '1321.50',
      tiers: [
        {
          tierId: GENERAL_ID,
          name: 'General',
          price: '45.00',
          quantity: 80,
          ticketsSold: 20,
          revenue: '900.00',
        },
        {
          tierId: VIP_ID,
          name: 'VIP',
          price: '84.30',
          quantity: 20,
          ticketsSold: 5,
          revenue: '421.50',
        },
      ],
    },
    {
      eventId: '33333333-3333-4333-8333-333333333333',
      name: 'Winter Gala',
      venueName: 'Freedom Hall',
      startsAt: '2026-12-20T23:00:00.000Z',
      status: 'SCHEDULED',
      ticketCapacity: 200,
      ticketsSold: 50,
      checkedIn: 0,
      revenue: '3000.00',
      tiers: [],
    },
    {
      eventId: '44444444-4444-4444-8444-444444444444',
      name: 'Rained Out',
      venueName: 'Freedom Hall',
      startsAt: '2026-10-20T23:00:00.000Z',
      status: 'CANCELLED',
      ticketCapacity: 50,
      ticketsSold: 0,
      checkedIn: 0,
      revenue: '0.00',
      tiers: [],
    },
  ],
};

const ticket = (id: string, code: string, checkedInAt: string | null, status = 'VALID') => ({
  id,
  code,
  status,
  checkedInAt,
  seat: null as { section: string; row: number; seat: number } | null,
});

export const ORDERS = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    eventId: EVENT.id,
    tierId: VIP_ID,
    tierName: 'VIP',
    customerUsername: 'customer3',
    quantity: 2,
    unitPrice: '84.30',
    totalPrice: '168.60',
    status: 'CONFIRMED',
    createdAt: '2026-09-30T15:00:00.000Z',
    refundedAt: null,
    tickets: [
      ticket('a1111111-1111-4111-8111-111111111111', 'ABCDEFGH2345', '2026-11-01T22:45:00.000Z'),
      ticket('a2222222-2222-4222-8222-222222222222', 'JKLMNPQR6789', null),
    ],
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    eventId: EVENT.id,
    tierId: GENERAL_ID,
    tierName: 'General',
    customerUsername: 'customer1',
    quantity: 1,
    unitPrice: '45.00',
    totalPrice: '45.00',
    status: 'REFUNDED',
    createdAt: '2026-09-30T16:00:00.000Z',
    refundedAt: '2026-09-30T17:00:00.000Z',
    tickets: [ticket('b1111111-1111-4111-8111-111111111111', 'STUVWXYZ2345', null, 'VOID')],
  },
];
