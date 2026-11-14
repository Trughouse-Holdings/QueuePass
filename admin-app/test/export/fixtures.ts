import type { Event, Order, SalesReport, Ticket } from '@queuepass/shared';
import { EVENT, REPORT } from '../fixtures-005';

/** Spec 023: an event in Central Time with every attendee edge case (T003). */
export const CHICAGO_EVENT = {
  ...EVENT,
  name: 'Export Test, Café',
  location: { ...EVENT.location, timeZone: 'America/Chicago' },
} as unknown as Event;

type Seat = { section: string; row: number; seat: number; rowLabel: string; seatLabel: string };

/** Spec 038 (contract 2.0.0): every ticket has its price; a seated one its level and labels. */
const ticket = (
  id: string,
  code: string,
  checkedInAt: string | null = null,
  status: 'VALID' | 'VOID' = 'VALID',
  price = '45.00',
  seat: Seat | null = null,
  levelName: string | null = null,
): Ticket => ({ id, code, status, checkedInAt, seat, price, levelName });

const order = (o: Partial<Order> & Pick<Order, 'id' | 'tickets'>): Order => ({
  eventId: EVENT.id,
  tierId: null,
  tierName: null,
  customerUsername: 'customer1',
  holderName: 'Jordan Lee',
  quantity: o.tickets.length,
  unitPrice: '45.00',
  totalPrice: '45.00',
  status: 'CONFIRMED',
  createdAt: '2026-09-30T15:00:00.000Z',
  refundedAt: null,
  ...o,
});

export const EXPORT_ORDERS: Order[] = [
  order({
    id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
    tierId: 'vip',
    tierName: 'VIP',
    customerUsername: 'customer3',
    holderName: 'Jordan Lee',
    unitPrice: '84.30',
    totalPrice: '168.60',
    createdAt: '2026-09-30T15:00:00.000Z',
    tickets: [
      ticket('t1', 'ABCDEFGH2345', '2026-11-01T22:45:00.000Z', 'VALID', '84.30'),
      ticket('t2', 'JKLMNPQR6789', null, 'VALID', '84.30'),
    ],
  }),
  order({
    id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb',
    customerUsername: 'customer2',
    holderName: '=SUM(1,1)',
    createdAt: '2026-10-02T01:30:00.000Z',
    tickets: [ticket('t3', 'STUVWXYZ2345')],
  }),
  order({
    id: 'cccccccc-3333-4ccc-8ccc-cccccccccccc',
    tierId: 'floor',
    tierName: 'Floor',
    customerUsername: 'customer3',
    holderName: 'Zoë O’Brien',
    unitPrice: '60.00',
    totalPrice: '60.00',
    createdAt: '2026-10-03T12:00:00.000Z',
    // Spec 038 R17: a carried-over seated ticket keeps its ticket type's name as its level name.
    tickets: [
      ticket(
        't4',
        'MNPQRSTU2345',
        null,
        'VALID',
        '60.00',
        { section: 'A', row: 3, seat: 7, rowLabel: 'C', seatLabel: '7' },
        'Floor',
      ),
    ],
  }),
  order({
    id: 'dddddddd-4444-4ddd-8ddd-dddddddddddd',
    tierId: 'general',
    tierName: 'General',
    customerUsername: 'customer1',
    holderName: null,
    status: 'REFUNDED',
    refundedAt: '2026-10-05T12:00:00.000Z',
    createdAt: '2026-10-04T12:00:00.000Z',
    tickets: [ticket('t5', 'VWXYZ2345678', '2026-10-06T12:00:00.000Z', 'VOID')],
  }),
  // Spec 038 FR-030: seats of two levels, so no unit price; each ticket has its own.
  order({
    id: 'eeeeeeee-5555-4eee-8eee-eeeeeeeeeeee',
    customerUsername: 'customer4',
    holderName: 'Sam Park',
    unitPrice: null,
    totalPrice: '155.00',
    createdAt: '2026-10-07T12:00:00.000Z',
    tickets: [
      ticket(
        't6',
        'BCDFGHJK2345',
        null,
        'VALID',
        '95.00',
        { section: '115', row: 4, seat: 2, rowLabel: 'D', seatLabel: '2' },
        'Courtside',
      ),
      ticket(
        't7',
        'LMNPQRST6789',
        null,
        'VALID',
        '60.00',
        { section: '115', row: 6, seat: 7, rowLabel: 'F', seatLabel: '7' },
        'Lower sideline',
      ),
    ],
  }),
];

/** Spec 023: the report with two zones and a cancelled event (T004). */
export const EXPORT_REPORT: SalesReport = {
  ...(REPORT as unknown as SalesReport),
  generatedAt: '2026-10-30T18:05:00.000Z',
  events: (REPORT as unknown as SalesReport).events.map((e, i) =>
    i === 1 ? { ...e, timeZone: 'America/Los_Angeles' } : { ...e, timeZone: 'America/New_York' },
  ),
};
