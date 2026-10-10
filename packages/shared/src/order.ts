import type { Event, EventStatus } from './event.js';
import type { SeatChoice, SeatLabel } from './seating.js';

/**
 * Mirrors the order, ticket, and report schemas in contracts/openapi.yaml (spec 005). Every
 * amount is a two-decimal STRING, never a number.
 */
export interface Ticket {
  id: string;
  code: string;
  status: 'VALID' | 'VOID';
  checkedInAt: string | null;
  /** Spec 007: the seat this ticket is for; `null` for general admission. */
  seat: SeatLabel | null;
}

export interface Order {
  id: string;
  eventId: string;
  tierId: string | null;
  tierName: string | null;
  customerUsername: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  status: 'CONFIRMED' | 'REFUNDED';
  createdAt: string;
  refundedAt: string | null;
  tickets: Ticket[];
}

export interface OrderInput {
  tierId?: string;
  quantity: number;
  /** Spec 006: one random id per confirmation, so repeating it never places a second order. */
  requestId?: string;
  /** Spec 007: required for reserved seating, one per ticket. */
  seats?: SeatChoice[];
}

/** Spec 006: the parts of an event My tickets shows next to an order. */
export interface OrderEvent {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  location: { id: string; name: string };
}

/** Spec 006: one of the signed-in customer's own orders (`GET /me/orders`). */
export interface MyOrder extends Order {
  event: OrderEvent;
}

/** Spec 006: why tickets cannot be ordered, or `null` while they can. */
export type SalesClosedReason = 'CANCELLED' | 'STARTED';

export interface TierAvailability {
  tierId: string;
  ticketsLeft: number;
}

/** Spec 006: tickets left for an event and its tiers (`GET /events/{id}/availability`). */
export interface Availability {
  eventId: string;
  ticketsLeft: number;
  salesClosed: SalesClosedReason | null;
  tiers: TierAvailability[];
}

export const ORDER_LIMITS = { maxQuantity: 10 } as const;

export interface Cancellation {
  event: Event;
  ordersRefunded: number;
  ticketsVoided: number;
}

export interface TierSales {
  tierId: string;
  name: string;
  price: string;
  quantity: number;
  ticketsSold: number;
  revenue: string;
}

export interface EventSales {
  eventId: string;
  name: string;
  venueName: string;
  startsAt: string;
  status: EventStatus;
  ticketCapacity: number;
  ticketsSold: number;
  checkedIn: number;
  revenue: string;
  tiers: TierSales[];
}

export interface SalesReport {
  generatedAt: string;
  totals: {
    events: number;
    ticketCapacity: number;
    ticketsSold: number;
    checkedIn: number;
    revenue: string;
  };
  events: EventSales[];
}
